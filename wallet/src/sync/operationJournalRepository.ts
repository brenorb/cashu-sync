import type { CashuDexie, WalletSyncStateRow } from "src/stores/dexie";
import { WALLET_SYNC_STATE_ID, initialWalletSyncState } from "src/stores/dexie";
import type {
  MeltQuoteRow,
  MintQuoteRow,
  PaymentHistoryRow,
} from "src/stores/paymentHistory";
import { LocalWalletRepository } from "src/sync/localWalletRepository";
import {
  decodeSerializedMeltPreviewV0,
  decodeSerializedMintPreviewV0,
} from "src/sync/previewCodec";
import {
  decodeSnapshotV0,
  type DecodeSnapshotOptions,
} from "src/sync/snapshotCodec";
import type {
  PendingMeltResponseV0,
  PendingMeltV0,
  PendingMintResponseV0,
  PendingMintV0,
  PendingOperationV0,
  SerializedMeltPreviewV0,
  SerializedMintPreviewV0,
  SnapshotProofV0,
  SnapshotV0,
} from "src/sync/types";
import { canonicalJson } from "src/sync/validation";

const OPERATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[0-9a-f]{64}$/;
const RESPONSE_INPUT_PHASES = [
  "prepared",
  "submitted",
  "needs_reconciliation",
] as const;

export type OperationJournalErrorCode =
  | "invalid-operation"
  | "slot-occupied"
  | "operation-mismatch"
  | "invalid-transition"
  | "timestamp"
  | "proof-mismatch"
  | "proof-collision"
  | "quote-mismatch"
  | "history-mismatch"
  | "invalid-response"
  | "stale-candidate";

export class OperationJournalError extends Error {
  readonly code: OperationJournalErrorCode;

  constructor(
    code: OperationJournalErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OperationJournalError";
    this.code = code;
  }
}

export class OperationJournalRepository {
  private readonly decodeOptions: DecodeSnapshotOptions;
  private readonly walletRepository: LocalWalletRepository;
  private readonly configuredMint: string;

  constructor(
    private readonly db: CashuDexie,
    configuredMint: string,
    options: Omit<DecodeSnapshotOptions, "expectedMint"> = {}
  ) {
    this.decodeOptions = { ...options, expectedMint: configuredMint };
    this.walletRepository = new LocalWalletRepository(
      db,
      configuredMint,
      options
    );
    // Validate configuration before any monetary transaction can start.
    this.configuredMint = decodeSnapshotV0(
      emptySnapshot(configuredMint),
      this.decodeOptions
    ).mint;
  }

  async prepareMint(
    operationId: string,
    input: SerializedMintPreviewV0,
    timestamp: number
  ): Promise<void> {
    const preview = decodeSerializedMintPreviewV0(input);
    assertMintPreviewAmounts(preview);
    const pending = this.validatePending({
      type: "mint",
      operation_id: operationId,
      phase: "prepared",
      created_at: timestamp,
      updated_at: timestamp,
      prepared_request: preview,
      response: null,
    });

    await this.db.transaction("rw", [this.db.walletSyncState], async () => {
      const state = await this.getState();
      requireFreeSlot(state);
      await this.db.walletSyncState.put({
        ...state,
        pending_operation: pending,
      });
    });
  }

  async prepareMelt(
    operationId: string,
    input: SerializedMeltPreviewV0,
    timestamp: number
  ): Promise<void> {
    const preview = decodeSerializedMeltPreviewV0(input);
    assertMeltPreviewInputs(preview);
    const pending = this.validatePending({
      type: "melt",
      operation_id: operationId,
      phase: "prepared",
      created_at: timestamp,
      updated_at: timestamp,
      prepared_request: preview,
      response: null,
    });

    await this.db.transaction(
      "rw",
      [this.db.proofs, this.db.walletSyncState],
      async () => {
        const state = await this.getState();
        requireFreeSlot(state);
        const selected = await this.requireSelectedProofs(pending);
        await this.db.proofs.bulkPut(
          selected.map((proof) => ({
            ...proof,
            reserved: true,
            quote: pending.prepared_request.quote.quote,
          }))
        );
        await this.db.walletSyncState.put({
          ...state,
          pending_operation: pending,
        });
      }
    );
  }

  async markSubmitted(
    operationId: string,
    type: "mint" | "melt",
    timestamp: number
  ): Promise<void> {
    assertOperationId(operationId);
    await this.db.transaction("rw", [this.db.walletSyncState], async () => {
      const state = await this.getState();
      const pending = requirePending(state, operationId, type);
      if (pending.phase !== "prepared") {
        throw new OperationJournalError(
          "invalid-transition",
          "markSubmitted requires a prepared operation"
        );
      }
      assertMonotonicTimestamp(pending, timestamp);
      const next = this.validatePending({
        ...pending,
        phase: "submitted",
        updated_at: timestamp,
      });
      await this.db.walletSyncState.put({
        ...state,
        pending_operation: next,
      });
    });
  }

  async recordMintResponse(
    operationId: string,
    input: PendingMintResponseV0,
    timestamp: number
  ): Promise<void> {
    assertOperationId(operationId);
    const response = this.validateMintResponseProofs(input);

    await this.db.transaction(
      "rw",
      [
        this.db.proofs,
        this.db.mintQuotes,
        this.db.paymentHistory,
        this.db.walletSyncState,
      ],
      async () => {
        const state = await this.getState();
        const pending = requirePending(state, operationId, "mint");
        requireResponseInputPhase(pending);
        assertMonotonicTimestamp(pending, timestamp);
        assertMintResponseMatchesPreview(pending, response);
        const quote = await this.requireMintQuote(pending);
        const history = await this.requireHistory(
          "mint",
          pending.prepared_request.quote.quote,
          pending.prepared_request.quote.request
        );
        await this.requireNoProofCollisions(response.proofs);
        const next = this.validatePending({
          ...pending,
          phase: "response_recorded",
          updated_at: timestamp,
          response,
        });

        await this.db.proofs.bulkAdd(response.proofs);
        await requireUpdated(
          this.db.mintQuotes.update(quote.quote, { state: "ISSUED" }),
          "quote-mismatch",
          "mint quote disappeared during response recording"
        );
        await this.db.paymentHistory.bulkPut(
          history.map((row) => ({
            ...row,
            status: "paid",
            paidDate: isoTimestamp(timestamp),
          }))
        );
        await this.db.walletSyncState.put({
          ...state,
          pending_operation: next,
        });
      }
    );
  }

  async recordMeltResponse(
    operationId: string,
    input: PendingMeltResponseV0,
    timestamp: number
  ): Promise<void> {
    assertOperationId(operationId);
    const response = this.validateMeltResponse(input);

    await this.db.transaction(
      "rw",
      [
        this.db.proofs,
        this.db.meltQuotes,
        this.db.paymentHistory,
        this.db.walletSyncState,
      ],
      async () => {
        const state = await this.getState();
        const pending = requirePending(state, operationId, "melt");
        requireMeltResponseInputPhase(pending);
        assertMonotonicTimestamp(pending, timestamp);
        assertMeltResponseMatchesPreview(pending, response);
        const selected = await this.requireReservedSelectedProofs(pending);
        const quote = await this.requireMeltQuote(pending);
        const history = await this.requireHistory(
          "melt",
          pending.prepared_request.quote.quote,
          pending.prepared_request.quote.request
        );
        await this.requireNoProofCollisions(response.change);
        const next = this.validatePending({
          ...pending,
          phase: "response_recorded",
          updated_at: timestamp,
          response,
        });

        // Within the transaction, make response/change durable before a PAID
        // result removes any input. A later failure rolls every step back.
        if (response.change.length > 0) {
          await this.db.proofs.bulkAdd(response.change);
        }
        await this.db.walletSyncState.put({
          ...state,
          pending_operation: next,
        });
        if (response.state === "PAID") {
          await this.db.proofs.bulkDelete(
            selected.map((proof) => proof.secret)
          );
        }
        await requireUpdated(
          this.db.meltQuotes.update(quote.quote, {
            state: response.state,
            payment_preimage: response.payment_preimage,
          }),
          "quote-mismatch",
          "melt quote disappeared during response recording"
        );
        await this.db.paymentHistory.bulkPut(
          history.map((row) =>
            historyForMeltState(row, response.state, timestamp)
          )
        );
      }
    );
  }

  /** Use only after a proven pre-mint CAS rejection, never after a timeout. */
  async abortPrepared(
    operationId: string,
    type: "mint" | "melt"
  ): Promise<void> {
    assertOperationId(operationId);
    await this.db.transaction(
      "rw",
      [this.db.proofs, this.db.walletSyncState],
      async () => {
        const state = await this.getState();
        const pending = requirePending(state, operationId, type);
        if (pending.phase !== "prepared") {
          throw new OperationJournalError(
            "invalid-transition",
            "only a prepared operation may be aborted"
          );
        }
        if (pending.type === "melt") {
          const selected = await this.requireReservedSelectedProofs(pending);
          await this.db.proofs.bulkPut(
            selected.map(({ quote: _quote, ...proof }) => ({
              ...proof,
              reserved: false,
            }))
          );
        }
        await this.db.walletSyncState.put({
          ...state,
          // Counters are deliberately preserved; reserved NUT-13 ranges burn.
          pending_operation: null,
        });
      }
    );
  }

  async candidateWithClearedOperation(
    operationId: string
  ): Promise<SnapshotV0> {
    assertOperationId(operationId);
    const current = await this.walletRepository.exportSnapshot();
    if (current.pending_operation?.operation_id !== operationId) {
      throw new OperationJournalError(
        "operation-mismatch",
        "pending operation ID does not match"
      );
    }
    return this.buildClearedCandidate(current);
  }

  async finalizeAcceptedSnapshot(
    candidate: SnapshotV0,
    eventId: string
  ): Promise<void> {
    if (!EVENT_ID.test(eventId)) {
      throw new OperationJournalError(
        "stale-candidate",
        "accepted event ID must be 64 lowercase hex characters"
      );
    }
    const validated = decodeSnapshotV0(candidate, this.decodeOptions);
    if (validated.pending_operation !== null) {
      throw new OperationJournalError(
        "stale-candidate",
        "accepted final candidate must clear the pending operation"
      );
    }
    const current = await this.walletRepository.exportSnapshot();
    if (current.pending_operation === null) {
      throw new OperationJournalError(
        "stale-candidate",
        "local pending operation was already cleared"
      );
    }
    const expected = this.buildClearedCandidate(current);
    if (canonicalJson(validated) !== canonicalJson(expected)) {
      throw new OperationJournalError(
        "stale-candidate",
        "accepted snapshot does not exactly extend current local state"
      );
    }
    await this.walletRepository.applySnapshot(validated, eventId);
  }

  private async getState(): Promise<WalletSyncStateRow> {
    return (
      (await this.db.walletSyncState.get(WALLET_SYNC_STATE_ID)) ??
      initialWalletSyncState()
    );
  }

  private buildClearedCandidate(current: SnapshotV0): SnapshotV0 {
    const pending = current.pending_operation;
    if (pending === null || pending.phase !== "response_recorded") {
      throw new OperationJournalError(
        "invalid-transition",
        "final CAS requires a response_recorded operation"
      );
    }
    if (
      pending.type === "melt" &&
      (pending.response === null || pending.response.state === "PENDING")
    ) {
      throw new OperationJournalError(
        "invalid-transition",
        "a PENDING melt must remain in the journal for reconciliation"
      );
    }
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
      throw new OperationJournalError(
        "invalid-operation",
        "snapshot revision cannot be incremented safely"
      );
    }
    let proofs = current.proofs;
    if (pending.type === "melt" && pending.response?.state === "UNPAID") {
      const selected = new Map(
        pending.prepared_request.request.inputs.map((proof) => [
          proof.secret,
          proof,
        ])
      );
      for (const input of selected.values()) {
        const proof = current.proofs.find(
          (candidate) => candidate.secret === input.secret
        );
        if (
          proof === undefined ||
          !sameSelectedProof(proof, input) ||
          !proof.reserved ||
          proof.quote !== pending.prepared_request.quote.quote
        ) {
          throw new OperationJournalError(
            "proof-mismatch",
            "UNPAID melt inputs no longer exactly match the journal"
          );
        }
      }
      proofs = current.proofs.map((proof) => {
        const input = selected.get(proof.secret);
        if (
          input === undefined ||
          !sameSelectedProof(proof, input) ||
          !proof.reserved ||
          proof.quote !== pending.prepared_request.quote.quote
        ) {
          return proof;
        }
        const { quote: _quote, ...released } = proof;
        return { ...released, reserved: false };
      });
    }
    return decodeSnapshotV0(
      {
        ...current,
        revision: current.revision + 1,
        proofs,
        pending_operation: null,
      },
      this.decodeOptions
    );
  }

  private validatePending<T extends PendingOperationV0>(input: T): T {
    try {
      return decodeSnapshotV0(
        { ...emptySnapshot(this.configuredMint), pending_operation: input },
        this.decodeOptions
      ).pending_operation as T;
    } catch (cause) {
      throw new OperationJournalError(
        "invalid-operation",
        "invalid pending operation",
        { cause }
      );
    }
  }

  private validateProofs(input: SnapshotProofV0[]): SnapshotProofV0[] {
    try {
      const proofs = decodeSnapshotV0(
        { ...emptySnapshot(this.configuredMint), proofs: input },
        this.decodeOptions
      ).proofs;
      if (
        proofs.some(
          (proof) =>
            proof.amount <= 0 || proof.reserved || proof.quote !== undefined
        )
      ) {
        throw new Error(
          "new response proofs must be positive, unreserved, and unassociated"
        );
      }
      return proofs;
    } catch (cause) {
      throw new OperationJournalError(
        "invalid-response",
        "invalid response proofs",
        { cause }
      );
    }
  }

  private validateMintResponseProofs(
    input: PendingMintResponseV0
  ): PendingMintResponseV0 {
    if (
      typeof input !== "object" ||
      input === null ||
      !Array.isArray(input.proofs)
    ) {
      throw new OperationJournalError(
        "invalid-response",
        "mint response must contain proofs"
      );
    }
    assertExactResponseKeys(input as unknown as Record<string, unknown>, [
      "proofs",
    ]);
    return { proofs: this.validateProofs(input.proofs) };
  }

  private validateMeltResponse(
    input: PendingMeltResponseV0
  ): PendingMeltResponseV0 {
    if (typeof input !== "object" || input === null) {
      throw new OperationJournalError(
        "invalid-response",
        "melt response must be an object"
      );
    }
    assertExactResponseKeys(input as unknown as Record<string, unknown>, [
      "state",
      "payment_preimage",
      "change",
    ]);
    const phaseProbe: PendingMeltV0 = {
      type: "melt",
      operation_id: "00000000-0000-4000-8000-000000000000",
      phase: "response_recorded",
      created_at: 0,
      updated_at: 0,
      prepared_request: probeMeltPreview(),
      response: input,
    };
    let decoded: PendingMeltV0;
    try {
      decoded = this.validatePending(phaseProbe) as PendingMeltV0;
    } catch (cause) {
      throw new OperationJournalError(
        "invalid-response",
        "invalid melt response",
        { cause }
      );
    }
    const response = decoded.response!;
    const change = this.validateProofs(response.change);
    if (response.state !== "PAID" && change.length > 0) {
      throw new OperationJournalError(
        "invalid-response",
        "non-PAID melt response cannot contain change proofs"
      );
    }
    if (response.state !== "PAID" && response.payment_preimage !== null) {
      throw new OperationJournalError(
        "invalid-response",
        "non-PAID melt response cannot contain a payment preimage"
      );
    }
    return { ...response, change };
  }

  private async requireSelectedProofs(
    pending: PendingMeltV0
  ): Promise<SnapshotProofV0[]> {
    const inputs = pending.prepared_request.request.inputs;
    const stored = await this.db.proofs.bulkGet(
      inputs.map((proof) => proof.secret)
    );
    return inputs.map((input, index) => {
      const proof = stored[index];
      if (!proof || !sameSelectedProof(proof, input) || proof.reserved) {
        throw new OperationJournalError(
          "proof-mismatch",
          `selected input ${input.secret} is missing, mismatched, or reserved`
        );
      }
      return proof;
    });
  }

  private async requireReservedSelectedProofs(
    pending: PendingMeltV0
  ): Promise<SnapshotProofV0[]> {
    const inputs = pending.prepared_request.request.inputs;
    const quoteId = pending.prepared_request.quote.quote;
    const stored = await this.db.proofs.bulkGet(
      inputs.map((proof) => proof.secret)
    );
    return inputs.map((input, index) => {
      const proof = stored[index];
      if (
        !proof ||
        !sameSelectedProof(proof, input) ||
        !proof.reserved ||
        proof.quote !== quoteId
      ) {
        throw new OperationJournalError(
          "proof-mismatch",
          `reserved input ${input.secret} no longer exactly matches the operation`
        );
      }
      return proof;
    });
  }

  private async requireNoProofCollisions(
    proofs: SnapshotProofV0[]
  ): Promise<void> {
    if (proofs.length === 0) return;
    if (new Set(proofs.map((proof) => proof.C)).size !== proofs.length) {
      throw new OperationJournalError(
        "proof-collision",
        "response contains duplicate proof commitments"
      );
    }
    const [bySecret, byCommitment] = await Promise.all([
      this.db.proofs.bulkGet(proofs.map((proof) => proof.secret)),
      this.db.proofs
        .where("C")
        .anyOf(proofs.map((proof) => proof.C))
        .toArray(),
    ]);
    if (
      bySecret.some((proof) => proof !== undefined) ||
      byCommitment.length > 0
    ) {
      throw new OperationJournalError(
        "proof-collision",
        "response proof secret collides with local wallet state"
      );
    }
  }

  private async requireMintQuote(
    pending: PendingMintV0
  ): Promise<MintQuoteRow> {
    const expected = pending.prepared_request.quote;
    const row = (await this.db.mintQuotes.get(expected.quote)) as
      | MintQuoteRow
      | undefined;
    if (
      !row ||
      row.method !== "bolt11" ||
      row.unit !== "usd" ||
      row.request !== expected.request ||
      row.amount !== safeDecimalNumber(expected.amount) ||
      row.state !== "PAID"
    ) {
      throw new OperationJournalError(
        "quote-mismatch",
        "mint quote does not exactly match the prepared operation"
      );
    }
    return row;
  }

  private async requireMeltQuote(
    pending: PendingMeltV0
  ): Promise<MeltQuoteRow> {
    const expected = pending.prepared_request.quote;
    const row = (await this.db.meltQuotes.get(expected.quote)) as
      | MeltQuoteRow
      | undefined;
    if (
      !row ||
      row.method !== "bolt11" ||
      row.unit !== "usd" ||
      row.request !== expected.request ||
      row.amount !== safeDecimalNumber(expected.amount) ||
      row.fee_reserve !== safeDecimalNumber(expected.fee_reserve) ||
      (row.state !== "UNPAID" && row.state !== "PENDING")
    ) {
      throw new OperationJournalError(
        "quote-mismatch",
        "melt quote does not exactly match the prepared operation"
      );
    }
    return row;
  }

  private async requireHistory(
    direction: "mint" | "melt",
    quote: string,
    request: string
  ): Promise<PaymentHistoryRow[]> {
    const rows = (await this.db.paymentHistory
      .where("[direction+quote]")
      .equals([direction, quote])
      .toArray()) as PaymentHistoryRow[];
    if (
      rows.length !== 1 ||
      rows.some(
        (row) =>
          row.method !== "bolt11" ||
          (row.paymentType !== undefined && row.paymentType !== "bolt11") ||
          row.unit !== "usd" ||
          row.mint !== this.configuredMint ||
          row.request !== request
      )
    ) {
      throw new OperationJournalError(
        "history-mismatch",
        "payment history does not exactly match the prepared operation"
      );
    }
    return rows;
  }
}

function emptySnapshot(mint: string): SnapshotV0 {
  return {
    schema: 0,
    revision: 0,
    previous_event_id: "",
    mint,
    unit: "usd",
    proofs: [],
    counters: {},
    quotes: [],
    history: [],
    pending_operation: null,
  };
}

function probeMeltPreview(): SerializedMeltPreviewV0 {
  return {
    method: "bolt11",
    keyset_id: "probe",
    quote: {
      quote: "probe",
      request: "probe",
      amount: "0",
      fee_reserve: "0",
      unit: "usd",
      state: "UNPAID",
      expiry: 0,
      payment_preimage: null,
    },
    request: { quote: "probe", inputs: [], outputs: [], prefer_async: false },
    output_data: [],
  };
}

function requireFreeSlot(state: WalletSyncStateRow): void {
  if (state.pending_operation !== null) {
    throw new OperationJournalError(
      "slot-occupied",
      "wallet already has a pending monetary operation"
    );
  }
}

function assertExactResponseKeys(
  input: Record<string, unknown>,
  expected: string[]
): void {
  const keys = Object.keys(input).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(keys) !== canonicalJson(wanted)) {
    throw new OperationJournalError(
      "invalid-response",
      "response contains missing or unknown fields"
    );
  }
}

function assertOperationId(operationId: string): void {
  if (!OPERATION_ID.test(operationId)) {
    throw new OperationJournalError(
      "invalid-operation",
      "operation ID must be a UUID"
    );
  }
}

function requirePending<T extends "mint" | "melt">(
  state: WalletSyncStateRow,
  operationId: string,
  type: T
): Extract<PendingOperationV0, { type: T }> {
  const pending = state.pending_operation;
  if (
    pending === null ||
    pending.operation_id !== operationId ||
    pending.type !== type
  ) {
    throw new OperationJournalError(
      "operation-mismatch",
      "pending operation ID or type does not match"
    );
  }
  return pending as Extract<PendingOperationV0, { type: T }>;
}

function assertMonotonicTimestamp(
  pending: PendingOperationV0,
  timestamp: number
): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < pending.updated_at) {
    throw new OperationJournalError(
      "timestamp",
      "operation timestamp must be a monotonic safe integer"
    );
  }
}

function requireResponseInputPhase(pending: PendingOperationV0): void {
  if (
    !RESPONSE_INPUT_PHASES.includes(
      pending.phase as (typeof RESPONSE_INPUT_PHASES)[number]
    )
  ) {
    throw new OperationJournalError(
      "invalid-transition",
      "response requires prepared, submitted, or needs_reconciliation phase"
    );
  }
}

function requireMeltResponseInputPhase(pending: PendingMeltV0): void {
  if (pending.phase === "response_recorded") {
    if (
      pending.response !== null &&
      (pending.response.state === "PENDING" ||
        pending.response.state === "UNPAID")
    ) {
      return;
    }
    throw new OperationJournalError(
      "invalid-transition",
      "a terminal melt response cannot be replaced"
    );
  }
  requireResponseInputPhase(pending);
}

function safeDecimalNumber(value: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new OperationJournalError(
      "invalid-operation",
      "amount exceeds the safe integer range"
    );
  }
  return amount;
}

function assertMintPreviewAmounts(preview: SerializedMintPreviewV0): void {
  if (preview.quote.state !== "PAID") {
    throw new OperationJournalError(
      "invalid-operation",
      "mint preparation requires a PAID quote"
    );
  }
  assertUniquePreparedOutputs(preview.output_data);
  const total = preview.request.outputs.reduce(
    (sum, output) => sum + safeDecimalNumber(output.amount),
    0
  );
  if (
    !Number.isSafeInteger(total) ||
    preview.request.outputs.some(
      (output) => safeDecimalNumber(output.amount) <= 0
    ) ||
    total !== safeDecimalNumber(preview.quote.amount)
  ) {
    throw new OperationJournalError(
      "invalid-operation",
      "mint output amounts must equal the quote amount"
    );
  }
}

function assertMeltPreviewInputs(preview: SerializedMeltPreviewV0): void {
  if (preview.quote.state !== "UNPAID") {
    throw new OperationJournalError(
      "invalid-operation",
      "melt preparation requires an UNPAID quote"
    );
  }
  assertUniquePreparedOutputs(preview.output_data);
  const secrets = new Set(preview.request.inputs.map((proof) => proof.secret));
  const commitments = new Set(preview.request.inputs.map((proof) => proof.C));
  if (
    secrets.size !== preview.request.inputs.length ||
    commitments.size !== preview.request.inputs.length
  ) {
    throw new OperationJournalError(
      "invalid-operation",
      "melt selected inputs contain a duplicate proof"
    );
  }
  const inputAmount = preview.request.inputs.reduce(
    (sum, proof) => sum + safeDecimalNumber(proof.amount),
    0
  );
  if (
    !Number.isSafeInteger(inputAmount) ||
    preview.request.inputs.some(
      (proof) => safeDecimalNumber(proof.amount) <= 0
    ) ||
    inputAmount < safeDecimalNumber(preview.quote.amount)
  ) {
    throw new OperationJournalError(
      "invalid-operation",
      "melt selected inputs do not cover the quote amount"
    );
  }
}

function assertUniquePreparedOutputs(
  outputs: SerializedMintPreviewV0["output_data"]
): void {
  const secrets = new Set(outputs.map((output) => output.secret.toLowerCase()));
  const commitments = new Set(
    outputs.map((output) => output.blindedMessage.B_)
  );
  if (secrets.size !== outputs.length || commitments.size !== outputs.length) {
    throw new OperationJournalError(
      "invalid-operation",
      "prepared outputs contain duplicate secrets or commitments"
    );
  }
}

function sameSelectedProof(
  stored: SnapshotProofV0,
  selected: { id: string; amount: string; secret: string; C: string }
): boolean {
  return (
    stored.id === selected.id &&
    stored.amount === safeDecimalNumber(selected.amount) &&
    stored.secret === selected.secret &&
    stored.C === selected.C
  );
}

function assertMintResponseMatchesPreview(
  pending: PendingMintV0,
  response: PendingMintResponseV0
): void {
  const outputs = pending.prepared_request.request.outputs;
  const outputData = pending.prepared_request.output_data;
  if (
    response.proofs.length !== outputs.length ||
    response.proofs.some((proof, index) => {
      const output = outputs[index];
      const prepared = outputData[index];
      return (
        output === undefined ||
        prepared === undefined ||
        proof.id !== output.id ||
        proof.id !== prepared.blindedMessage.id ||
        proof.amount !== safeDecimalNumber(output.amount) ||
        proof.secret.toLowerCase() !== prepared.secret.toLowerCase()
      );
    })
  ) {
    throw new OperationJournalError(
      "invalid-response",
      "mint response proofs do not match prepared output secrets, keysets, amounts, and order"
    );
  }
}

function assertMeltResponseMatchesPreview(
  pending: PendingMeltV0,
  response: PendingMeltResponseV0
): void {
  const preview = pending.prepared_request;
  if (
    response.change.length > preview.output_data.length ||
    response.change.some((proof, index) => {
      const prepared = preview.output_data[index];
      return (
        prepared === undefined ||
        proof.id !== preview.keyset_id ||
        proof.id !== prepared.blindedMessage.id ||
        proof.secret.toLowerCase() !== prepared.secret.toLowerCase()
      );
    })
  ) {
    throw new OperationJournalError(
      "invalid-response",
      "melt change does not match prepared output secrets, keysets, and order"
    );
  }
  const inputAmount = preview.request.inputs.reduce(
    (sum, proof) => sum + safeDecimalNumber(proof.amount),
    0
  );
  const changeAmount = response.change.reduce(
    (sum, proof) => sum + proof.amount,
    0
  );
  if (
    !Number.isSafeInteger(changeAmount) ||
    changeAmount > inputAmount - safeDecimalNumber(preview.quote.amount)
  ) {
    throw new OperationJournalError(
      "invalid-response",
      "melt change exceeds the selected input remainder"
    );
  }
}

function isoTimestamp(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp)) {
    throw new OperationJournalError(
      "timestamp",
      "timestamp must be a safe integer"
    );
  }
  return new Date(timestamp * 1000).toISOString();
}

function historyForMeltState(
  row: PaymentHistoryRow,
  state: PendingMeltResponseV0["state"],
  timestamp: number
): PaymentHistoryRow {
  if (state === "PAID") {
    return { ...row, status: "paid", paidDate: isoTimestamp(timestamp) };
  }
  const { paidDate: _paidDate, ...pending } = row;
  return { ...pending, status: "pending" };
}

async function requireUpdated(
  update: PromiseLike<number>,
  code: "quote-mismatch",
  message: string
): Promise<void> {
  if ((await update) !== 1) throw new OperationJournalError(code, message);
}
