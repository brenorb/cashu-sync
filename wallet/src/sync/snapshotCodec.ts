import {
  decodeSerializedMeltPreviewV0,
  decodeSerializedMintPreviewV0,
} from "./previewCodec";
import {
  SNAPSHOT_SCHEMA_V0,
  SNAPSHOT_UNIT_V0,
  type DleqV0,
  type MeltQuoteSnapshotV0,
  type MintQuoteSnapshotV0,
  type PaymentHistoryV0,
  type PendingMeltResponseV0,
  type PendingMeltV0,
  type PendingMintResponseV0,
  type PendingMintV0,
  type PendingOperationV0,
  type QuoteSnapshotV0,
  type SnapshotProofV0,
  type SnapshotV0,
} from "./types";
import {
  SyncValidationError,
  arrayValue,
  booleanValue,
  canonicalJson,
  enumValue,
  exactKeys,
  fail,
  record,
  safeInteger,
  stringValue,
  utf8Length,
} from "./validation";

export const SNAPSHOT_MAX_PLAINTEXT_BYTES_V0 = 60_000;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MINT_STATES = ["UNPAID", "PAID", "ISSUED"] as const;
const MELT_STATES = ["UNPAID", "PENDING", "PAID"] as const;
const OPERATION_PHASES = [
  "prepared",
  "submitted",
  "response_recorded",
  "needs_reconciliation",
] as const;

export class SnapshotValidationError extends SyncValidationError {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

export type DecodeSnapshotOptions = {
  expectedMint?: string;
  /** Test/dev escape hatch. Public HTTP mint hosts remain forbidden. */
  allowLoopbackHttp?: boolean;
};

function decodeDleq(value: unknown, path: string): DleqV0 {
  const input = record(value, path);
  exactKeys(input, ["e", "s"], ["r"], path);
  return {
    e: stringValue(input.e, `${path}.e`, { min: 1, max: 1024 }),
    s: stringValue(input.s, `${path}.s`, { min: 1, max: 1024 }),
    ...(input.r === undefined
      ? {}
      : { r: stringValue(input.r, `${path}.r`, { min: 1, max: 1024 }) }),
  };
}

function decodeProof(value: unknown, path: string): SnapshotProofV0 {
  const input = record(value, path);
  exactKeys(
    input,
    ["id", "amount", "secret", "C", "reserved"],
    ["quote", "dleq"],
    path
  );
  return {
    id: stringValue(input.id, `${path}.id`, { min: 1, max: 256 }),
    amount: safeInteger(input.amount, `${path}.amount`),
    secret: stringValue(input.secret, `${path}.secret`, {
      min: 1,
      max: 4096,
    }),
    C: stringValue(input.C, `${path}.C`, { min: 1, max: 1024 }),
    reserved: booleanValue(input.reserved, `${path}.reserved`),
    ...(input.quote === undefined
      ? {}
      : {
          quote: stringValue(input.quote, `${path}.quote`, {
            min: 1,
            max: 4096,
          }),
        }),
    ...(input.dleq === undefined
      ? {}
      : { dleq: decodeDleq(input.dleq, `${path}.dleq`) }),
  };
}

function decodeMintQuote(value: unknown, path: string): MintQuoteSnapshotV0 {
  const input = record(value, path);
  exactKeys(
    input,
    ["type", "quote", "request", "amount", "unit", "state", "expiry"],
    ["pubkey"],
    path
  );
  if (input.type !== "mint") fail(`${path}.type`, "expected mint");
  if (input.unit !== SNAPSHOT_UNIT_V0) fail(`${path}.unit`, "v0 requires usd");
  return {
    type: "mint",
    quote: stringValue(input.quote, `${path}.quote`, { min: 1, max: 4096 }),
    request: stringValue(input.request, `${path}.request`, {
      min: 1,
      max: 16_384,
    }),
    amount: safeInteger(input.amount, `${path}.amount`),
    unit: SNAPSHOT_UNIT_V0,
    state: enumValue(input.state, MINT_STATES, `${path}.state`),
    expiry:
      input.expiry === null
        ? null
        : safeInteger(input.expiry, `${path}.expiry`),
    ...(input.pubkey === undefined
      ? {}
      : {
          pubkey: stringValue(input.pubkey, `${path}.pubkey`, {
            min: 1,
            max: 1024,
          }),
        }),
  };
}

function decodeMeltQuote(value: unknown, path: string): MeltQuoteSnapshotV0 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "type",
      "quote",
      "request",
      "amount",
      "fee_reserve",
      "unit",
      "state",
      "expiry",
      "payment_preimage",
    ],
    [],
    path
  );
  if (input.type !== "melt") fail(`${path}.type`, "expected melt");
  if (input.unit !== SNAPSHOT_UNIT_V0) fail(`${path}.unit`, "v0 requires usd");
  return {
    type: "melt",
    quote: stringValue(input.quote, `${path}.quote`, { min: 1, max: 4096 }),
    request: stringValue(input.request, `${path}.request`, {
      min: 1,
      max: 16_384,
    }),
    amount: safeInteger(input.amount, `${path}.amount`),
    fee_reserve: safeInteger(input.fee_reserve, `${path}.fee_reserve`),
    unit: SNAPSHOT_UNIT_V0,
    state: enumValue(input.state, MELT_STATES, `${path}.state`),
    expiry: safeInteger(input.expiry, `${path}.expiry`),
    payment_preimage:
      input.payment_preimage === null
        ? null
        : stringValue(input.payment_preimage, `${path}.payment_preimage`, {
            max: 4096,
          }),
  };
}

function decodeQuote(value: unknown, path: string): QuoteSnapshotV0 {
  const input = record(value, path);
  if (input.type === "mint") return decodeMintQuote(input, path);
  if (input.type === "melt") return decodeMeltQuote(input, path);
  return fail(`${path}.type`, "expected mint or melt");
}

function decodeIsoDate(value: unknown, path: string): string {
  const result = stringValue(value, path, { min: 1, max: 64 });
  if (!Number.isFinite(Date.parse(result))) fail(path, "invalid date");
  return result;
}

function decodeHistory(
  value: unknown,
  path: string,
  options: DecodeSnapshotOptions
): PaymentHistoryV0 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "id",
      "direction",
      "quote",
      "amount",
      "request",
      "memo",
      "date",
      "status",
      "mint",
      "unit",
    ],
    ["paid_date", "label"],
    path
  );
  if (input.unit !== SNAPSHOT_UNIT_V0) fail(`${path}.unit`, "v0 requires usd");
  return {
    id: stringValue(input.id, `${path}.id`, { min: 1, max: 4096 }),
    direction: enumValue(
      input.direction,
      ["mint", "melt"],
      `${path}.direction`
    ),
    quote: stringValue(input.quote, `${path}.quote`, { min: 1, max: 4096 }),
    amount: safeInteger(input.amount, `${path}.amount`, {
      min: Number.MIN_SAFE_INTEGER,
    }),
    request: stringValue(input.request, `${path}.request`, {
      min: 1,
      max: 16_384,
    }),
    memo: stringValue(input.memo, `${path}.memo`, { max: 8192 }),
    date: decodeIsoDate(input.date, `${path}.date`),
    status: enumValue(input.status, ["pending", "paid"], `${path}.status`),
    mint: decodeMintUrl(input.mint, `${path}.mint`, options),
    unit: SNAPSHOT_UNIT_V0,
    ...(input.paid_date === undefined
      ? {}
      : { paid_date: decodeIsoDate(input.paid_date, `${path}.paid_date`) }),
    ...(input.label === undefined
      ? {}
      : { label: stringValue(input.label, `${path}.label`, { max: 1024 }) }),
  };
}

function decodeMintResponse(
  value: unknown,
  path: string
): PendingMintResponseV0 {
  const input = record(value, path);
  exactKeys(input, ["proofs"], [], path);
  return {
    proofs: arrayValue(input.proofs, `${path}.proofs`).map((entry, index) =>
      decodeProof(entry, `${path}.proofs[${index}]`)
    ),
  };
}

function decodeMeltResponse(
  value: unknown,
  path: string
): PendingMeltResponseV0 {
  const input = record(value, path);
  exactKeys(input, ["state", "payment_preimage", "change"], [], path);
  return {
    state: enumValue(input.state, MELT_STATES, `${path}.state`),
    payment_preimage:
      input.payment_preimage === null
        ? null
        : stringValue(input.payment_preimage, `${path}.payment_preimage`, {
            max: 4096,
          }),
    change: arrayValue(input.change, `${path}.change`).map((entry, index) =>
      decodeProof(entry, `${path}.change[${index}]`)
    ),
  };
}

function decodeOperationBase(input: Record<string, unknown>, path: string) {
  const createdAt = safeInteger(input.created_at, `${path}.created_at`);
  const updatedAt = safeInteger(input.updated_at, `${path}.updated_at`);
  if (updatedAt < createdAt) fail(`${path}.updated_at`, "precedes created_at");
  return {
    operation_id: stringValue(input.operation_id, `${path}.operation_id`, {
      min: 36,
      max: 36,
      pattern: OPERATION_ID_PATTERN,
    }),
    phase: enumValue(input.phase, OPERATION_PHASES, `${path}.phase`),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function decodePendingOperation(
  value: unknown,
  path: string
): PendingOperationV0 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "type",
      "operation_id",
      "phase",
      "created_at",
      "updated_at",
      "prepared_request",
      "response",
    ],
    [],
    path
  );
  const base = decodeOperationBase(input, path);
  if (input.type === "mint") {
    const response =
      input.response === null
        ? null
        : decodeMintResponse(input.response, `${path}.response`);
    assertResponsePhase(base.phase, response, path);
    return {
      type: "mint",
      ...base,
      prepared_request: decodeSerializedMintPreviewV0(
        input.prepared_request,
        `${path}.prepared_request`
      ),
      response,
    } as PendingMintV0;
  }
  if (input.type === "melt") {
    const response =
      input.response === null
        ? null
        : decodeMeltResponse(input.response, `${path}.response`);
    assertResponsePhase(base.phase, response, path);
    return {
      type: "melt",
      ...base,
      prepared_request: decodeSerializedMeltPreviewV0(
        input.prepared_request,
        `${path}.prepared_request`
      ),
      response,
    } as PendingMeltV0;
  }
  return fail(`${path}.type`, "expected mint or melt");
}

function assertResponsePhase(
  phase: PendingOperationV0["phase"],
  response: PendingMintResponseV0 | PendingMeltResponseV0 | null,
  path: string
) {
  if (phase === "response_recorded" && response === null) {
    fail(`${path}.response`, "response_recorded requires a response");
  }
  if (phase !== "response_recorded" && response !== null) {
    fail(`${path}.response`, `${phase} requires a null response`);
  }
}

function decodeMintUrl(
  value: unknown,
  path: string,
  options: DecodeSnapshotOptions = {}
): string {
  const result = stringValue(value, path, { min: 1, max: 2048 });
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    return fail(path, "invalid URL");
  }
  const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);
  const allowedLoopbackHttp =
    options.allowLoopbackHttp === true &&
    url.protocol === "http:" &&
    loopbackHosts.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !allowedLoopbackHttp) {
    fail(
      path,
      "mint URL must use https (HTTP is allowed only for loopback tests)"
    );
  }
  if (url.username || url.password || url.hash || url.search) {
    fail(path, "mint URL cannot contain credentials, query, or fragment");
  }
  return result.replace(/\/+$/, "");
}

function assertUnique<T>(values: T[], key: (entry: T) => string, path: string) {
  const seen = new Set<string>();
  for (const entry of values) {
    const id = key(entry);
    if (seen.has(id)) fail(path, `duplicate entry ${id}`);
    seen.add(id);
  }
}

function decodeSnapshotObject(
  value: unknown,
  options: DecodeSnapshotOptions
): SnapshotV0 {
  const input = record(value, "snapshot");
  exactKeys(
    input,
    [
      "schema",
      "revision",
      "previous_event_id",
      "mint",
      "unit",
      "proofs",
      "counters",
      "quotes",
      "history",
      "pending_operation",
    ],
    [],
    "snapshot"
  );
  if (input.schema !== SNAPSHOT_SCHEMA_V0) {
    fail("snapshot.schema", "unsupported schema");
  }
  if (input.unit !== SNAPSHOT_UNIT_V0) fail("snapshot.unit", "v0 requires usd");
  const mint = decodeMintUrl(input.mint, "snapshot.mint", options);
  if (options.expectedMint) {
    const expectedMint = decodeMintUrl(
      options.expectedMint,
      "expectedMint",
      options
    );
    if (mint !== expectedMint) fail("snapshot.mint", "wrong configured mint");
  }
  const previousEventId = stringValue(
    input.previous_event_id,
    "snapshot.previous_event_id",
    { max: 64 }
  );
  if (previousEventId && !EVENT_ID_PATTERN.test(previousEventId)) {
    fail(
      "snapshot.previous_event_id",
      "expected empty genesis ID or 64 hex chars"
    );
  }
  const proofs = arrayValue(input.proofs, "snapshot.proofs").map(
    (entry, index) => decodeProof(entry, `snapshot.proofs[${index}]`)
  );
  assertUnique(proofs, (proof) => proof.secret, "snapshot.proofs");

  const countersInput = record(input.counters, "snapshot.counters");
  const counters: Record<string, number> = {};
  for (const [key, counter] of Object.entries(countersInput)) {
    const keysetId = stringValue(key, "snapshot.counters key", {
      min: 1,
      max: 256,
    });
    counters[keysetId] = safeInteger(counter, `snapshot.counters.${keysetId}`);
  }

  const quotes = arrayValue(input.quotes, "snapshot.quotes").map(
    (entry, index) => decodeQuote(entry, `snapshot.quotes[${index}]`)
  );
  assertUnique(
    quotes,
    (quote) => `${quote.type}:${quote.quote}`,
    "snapshot.quotes"
  );
  const history = arrayValue(input.history, "snapshot.history").map(
    (entry, index) =>
      decodeHistory(entry, `snapshot.history[${index}]`, options)
  );
  assertUnique(history, (entry) => entry.id, "snapshot.history");
  if (history.some((entry) => entry.mint !== mint)) {
    fail("snapshot.history", "history contains a different mint");
  }

  return {
    schema: SNAPSHOT_SCHEMA_V0,
    revision: safeInteger(input.revision, "snapshot.revision", { min: 0 }),
    previous_event_id: previousEventId,
    mint,
    unit: SNAPSHOT_UNIT_V0,
    proofs,
    counters,
    quotes,
    history,
    pending_operation:
      input.pending_operation === null
        ? null
        : decodePendingOperation(
            input.pending_operation,
            "snapshot.pending_operation"
          ),
  };
}

export function decodeAndEncodeSnapshotV0(
  value: unknown,
  options: DecodeSnapshotOptions = {}
): { snapshot: SnapshotV0; encoded: string } {
  try {
    let parsed = value;
    if (typeof value === "string") {
      if (utf8Length(value) > SNAPSHOT_MAX_PLAINTEXT_BYTES_V0) {
        fail("snapshot", "plaintext size exceeds v0 limit");
      }
      try {
        parsed = JSON.parse(value);
      } catch {
        fail("snapshot", "invalid JSON");
      }
    }
    const snapshot = decodeSnapshotObject(parsed, options);
    const encoded = canonicalJson(snapshot);
    if (utf8Length(encoded) > SNAPSHOT_MAX_PLAINTEXT_BYTES_V0) {
      fail("snapshot", "plaintext size exceeds v0 limit");
    }
    return { snapshot, encoded };
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error;
    if (error instanceof SyncValidationError) {
      throw new SnapshotValidationError(error.message);
    }
    throw error;
  }
}

export function decodeSnapshotV0(
  value: unknown,
  options: DecodeSnapshotOptions = {}
): SnapshotV0 {
  return decodeAndEncodeSnapshotV0(value, options).snapshot;
}

export function encodeSnapshotV0(
  snapshot: SnapshotV0,
  options: DecodeSnapshotOptions = {}
): string {
  return decodeAndEncodeSnapshotV0(snapshot, options).encoded;
}
