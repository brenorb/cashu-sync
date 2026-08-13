export const SNAPSHOT_SCHEMA_V0 = 0 as const;
export const SNAPSHOT_UNIT_V0 = "usd" as const;
export const SYNC_EVENT_KIND_V0 = 30078 as const;
export const SYNC_EVENT_D_TAG_V0 =
  "com.silentlink.cashu-sync.wallet.v0" as const;

export type SnapshotUnitV0 = typeof SNAPSHOT_UNIT_V0;
export type DecimalAmountV0 = string;
export type OperationPhaseV0 =
  | "prepared"
  | "submitted"
  | "response_recorded"
  | "needs_reconciliation";

export type DleqV0 = {
  e: string;
  s: string;
  r?: string;
};

/** JSON-safe proof used by an exact Cashu request. Array order is normative. */
export type OrderedProofV0 = {
  id: string;
  amount: DecimalAmountV0;
  secret: string;
  C: string;
  dleq?: DleqV0;
};

/** Wallet proof plus local reservation metadata. */
export type SnapshotProofV0 = {
  id: string;
  amount: number;
  secret: string;
  C: string;
  reserved: boolean;
  quote?: string;
  dleq?: DleqV0;
};

export type OrderedBlindedMessageV0 = {
  amount: DecimalAmountV0;
  B_: string;
  id: string;
};

export type OrderedBlindedSignatureV0 = {
  amount: DecimalAmountV0;
  C_: string;
  id: string;
  dleq?: DleqV0;
};

export type SerializedOutputDataV0 = {
  blindedMessage: OrderedBlindedMessageV0;
  blindingFactor: string;
  secret: string;
  ephemeralE?: string;
};

export type SerializedMintQuoteV0 = {
  quote: string;
  request: string;
  amount: DecimalAmountV0;
  unit: SnapshotUnitV0;
  state: "UNPAID" | "PAID" | "ISSUED";
  expiry: number | null;
  pubkey?: string;
};

export type SerializedMeltQuoteV0 = {
  quote: string;
  request: string;
  amount: DecimalAmountV0;
  fee_reserve: DecimalAmountV0;
  unit: SnapshotUnitV0;
  state: "UNPAID" | "PENDING" | "PAID";
  expiry: number;
  payment_preimage: string | null;
  change?: OrderedBlindedSignatureV0[];
};

/**
 * Serializable cashu-ts MintPreview. `request.outputs` is the exact ordered
 * payload that is replayed after relay CAS; it must never be regenerated.
 */
export type SerializedMintPreviewV0 = {
  method: "bolt11";
  keyset_id: string;
  quote: SerializedMintQuoteV0;
  request: {
    quote: string;
    outputs: OrderedBlindedMessageV0[];
    signature?: string;
  };
  output_data: SerializedOutputDataV0[];
  legacy_signature?: string;
};

/**
 * Serializable cashu-ts MeltPreview plus the exact ordered NUT-05 request.
 * Both input and output order are covered by the encrypted signed snapshot.
 */
export type SerializedMeltPreviewV0 = {
  method: "bolt11";
  keyset_id: string;
  quote: SerializedMeltQuoteV0;
  request: {
    quote: string;
    inputs: OrderedProofV0[];
    outputs: OrderedBlindedMessageV0[];
    /** Explicit even when false so the replay payload has no implicit default. */
    prefer_async: boolean;
  };
  output_data: SerializedOutputDataV0[];
};

export type MintQuoteSnapshotV0 = {
  type: "mint";
  quote: string;
  request: string;
  amount: number;
  unit: SnapshotUnitV0;
  state: "UNPAID" | "PAID" | "ISSUED";
  expiry: number | null;
  pubkey?: string;
};

export type MeltQuoteSnapshotV0 = {
  type: "melt";
  quote: string;
  request: string;
  amount: number;
  fee_reserve: number;
  unit: SnapshotUnitV0;
  state: "UNPAID" | "PENDING" | "PAID";
  expiry: number;
  payment_preimage: string | null;
};

export type QuoteSnapshotV0 = MintQuoteSnapshotV0 | MeltQuoteSnapshotV0;

export type PaymentHistoryV0 = {
  id: string;
  direction: "mint" | "melt";
  quote: string;
  amount: number;
  request: string;
  memo: string;
  date: string;
  status: "pending" | "paid";
  mint: string;
  unit: SnapshotUnitV0;
  paid_date?: string;
  label?: string;
};

export type PendingMintResponseV0 = {
  proofs: SnapshotProofV0[];
};

export type PendingMeltResponseV0 = {
  state: "UNPAID" | "PENDING" | "PAID";
  payment_preimage: string | null;
  change: SnapshotProofV0[];
};

type PendingOperationBaseV0 = {
  operation_id: string;
  phase: OperationPhaseV0;
  created_at: number;
  updated_at: number;
};

export type PendingMintV0 = PendingOperationBaseV0 & {
  type: "mint";
  prepared_request: SerializedMintPreviewV0;
  response: PendingMintResponseV0 | null;
};

export type PendingMeltV0 = PendingOperationBaseV0 & {
  type: "melt";
  prepared_request: SerializedMeltPreviewV0;
  response: PendingMeltResponseV0 | null;
};

export type PendingOperationV0 = PendingMintV0 | PendingMeltV0;

/** Normal sync snapshots intentionally exclude mnemonic and sync credentials. */
export type SnapshotV0 = {
  schema: typeof SNAPSHOT_SCHEMA_V0;
  revision: number;
  previous_event_id: string;
  mint: string;
  unit: SnapshotUnitV0;
  proofs: SnapshotProofV0[];
  counters: Record<string, number>;
  quotes: QuoteSnapshotV0[];
  history: PaymentHistoryV0[];
  pending_operation: PendingOperationV0 | null;
};
