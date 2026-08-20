import {
  Amount,
  MeltQuoteState,
  MintQuoteState,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  type Proof,
  type SerializedBlindedMessage,
  type Wallet,
} from "@cashu/cashu-ts";
import type { CashuOperationGateway } from "src/sync/syncOperationCoordinator";
import {
  deserializeMeltPreviewV0,
  deserializeMintPreviewV0,
  serializeMeltPreviewV0,
  serializeMintPreviewV0,
} from "src/sync/previewCodec";
import type {
  PendingMeltResponseV0,
  PendingMintResponseV0,
  SerializedMeltPreviewV0,
  SerializedMintPreviewV0,
  SnapshotProofV0,
} from "src/sync/types";

export type MintOperationIntent = {
  amount: number;
  quote: MintQuoteBolt11Response;
  keysetId: string;
};

export type MeltOperationIntent = {
  quote: MeltQuoteBolt11Response;
  proofs: SnapshotProofV0[];
  keysetId: string;
  preferAsync?: boolean;
};

/**
 * Cashu protocol adapter for the fenced operation coordinator.
 *
 * Input selection is local. This adapter never calls Wallet.send(), swap(), or
 * any API that can create an unjournaled NUT-03 request.
 */
export class CashuTsOperationGateway
  implements CashuOperationGateway<MintOperationIntent, MeltOperationIntent>
{
  constructor(private readonly wallet: Wallet) {}

  async createMintPreview(
    intent: MintOperationIntent
  ): Promise<SerializedMintPreviewV0> {
    requirePositiveSafeAmount(intent.amount, "mint amount");
    requireUsdMintQuote(intent.quote);
    if (intent.quote.state !== MintQuoteState.PAID) {
      throw new Error("mint quote must be PAID before preparing outputs");
    }
    const preview = await this.wallet.prepareMint(
      "bolt11",
      intent.amount,
      intent.quote,
      { keysetId: intent.keysetId }
    );
    return serializeMintPreviewV0(preview);
  }

  async createMeltPreview(
    intent: MeltOperationIntent
  ): Promise<SerializedMeltPreviewV0> {
    requireUsdMeltQuote(intent.quote);
    if (intent.quote.state !== MeltQuoteState.UNPAID) {
      throw new Error("melt quote must be UNPAID before preparing inputs");
    }
    const target = intent.quote.amount.add(intent.quote.fee_reserve);
    const selected = this.wallet.selectProofsToSend(
      intent.proofs,
      target,
      true,
      false
    ).send;
    if (selected.length === 0) {
      throw new Error("no proofs selected for melt");
    }
    const preview = await this.wallet.prepareMelt(
      "bolt11",
      intent.quote,
      selected,
      { keysetId: intent.keysetId }
    );
    return serializeMeltPreviewV0(preview, intent.preferAsync ?? false);
  }

  async submitMint(
    exactPreview: SerializedMintPreviewV0
  ): Promise<PendingMintResponseV0> {
    const preview = deserializeMintPreviewV0(exactPreview);
    const proofs = await this.wallet.completeMint(preview);
    return { proofs: proofs.map(toSnapshotProof) };
  }

  async recreateMintPreview(
    exactPreview: SerializedMintPreviewV0
  ): Promise<SerializedMintPreviewV0> {
    const exact = deserializeMintPreviewV0(exactPreview);
    const quote = await this.wallet.checkMintQuoteBolt11(exact.quote.quote);
    if (quote.state !== MintQuoteState.PAID) {
      throw new Error(`mint quote is ${quote.state}; cannot reprepare outputs`);
    }
    const preview = await this.wallet.prepareMint(
      "bolt11",
      Amount.from(exact.quote.amount),
      exact.quote,
      { keysetId: exact.keysetId }
    );
    return serializeMintPreviewV0(preview);
  }

  async submitMelt(
    exactPreview: SerializedMeltPreviewV0
  ): Promise<PendingMeltResponseV0> {
    const exact = deserializeMeltPreviewV0(exactPreview);
    const response = await this.wallet.completeMelt(exact, undefined, {
      preferAsync: exactPreview.request.prefer_async,
    });
    return meltResponse(response.quote, response.change);
  }

  async reconcileMint(
    exactPreview: SerializedMintPreviewV0
  ): Promise<PendingMintResponseV0 | null> {
    const exact = deserializeMintPreviewV0(exactPreview);
    const quote = await this.wallet.checkMintQuoteBolt11(exact.quote.quote);
    requireUsdMintQuote(quote);
    if (quote.state !== MintQuoteState.ISSUED) return null;

    // NUT-09 is read-only: ask only for the exact blinded messages already
    // persisted before submission, then reconstruct proofs in prepared order.
    const restored = await this.wallet.mint.restore({
      outputs: exact.payload.outputs,
    });
    if (
      restored.outputs.length !== exact.payload.outputs.length ||
      restored.signatures.length !== exact.payload.outputs.length
    ) {
      return null;
    }

    const restoredByOutput = new Map<
      string,
      { output: SerializedBlindedMessage; signatureIndex: number }
    >();
    restored.outputs.forEach((output, signatureIndex) => {
      const key = outputKey(output);
      if (restoredByOutput.has(key)) {
        throw new Error("mint restore returned duplicate outputs");
      }
      restoredByOutput.set(key, { output, signatureIndex });
    });

    const proofs: SnapshotProofV0[] = [];
    for (let index = 0; index < exact.payload.outputs.length; index += 1) {
      const expected = exact.payload.outputs[index]!;
      const match = restoredByOutput.get(outputKey(expected));
      if (!match) return null;
      const signature = restored.signatures[match.signatureIndex];
      const outputData = exact.outputData[index];
      if (!signature || !outputData || signature.id !== expected.id) {
        return null;
      }
      proofs.push(
        toSnapshotProof(
          outputData.toProof(signature, this.wallet.getKeyset(signature.id))
        )
      );
    }
    return { proofs };
  }

  async reconcileMelt(
    exactPreview: SerializedMeltPreviewV0
  ): Promise<PendingMeltResponseV0 | null> {
    const exact = deserializeMeltPreviewV0(exactPreview);
    const quote = await this.wallet.checkMeltQuoteBolt11(exact.quote.quote);
    requireUsdMeltQuote(quote);
    if (quote.state !== MeltQuoteState.PAID) {
      return meltResponse(quote, []);
    }
    const change = this.wallet.createMeltChangeProofs(
      exact.outputData,
      quote.change ?? []
    );
    return meltResponse(quote, change);
  }
}

function meltResponse(
  quote: MeltQuoteBolt11Response,
  change: Proof[]
): PendingMeltResponseV0 {
  if (!Object.values(MeltQuoteState).includes(quote.state)) {
    throw new Error(`unsupported melt quote state: ${quote.state}`);
  }
  return {
    state: quote.state,
    payment_preimage:
      quote.state === MeltQuoteState.PAID ? quote.payment_preimage : null,
    change:
      quote.state === MeltQuoteState.PAID
        ? change.map(toSnapshotProof)
        : [],
  };
}

function toSnapshotProof(proof: Proof): SnapshotProofV0 {
  const amount = proof.amount.toNumber();
  requirePositiveSafeAmount(amount, "proof amount");
  if (proof.witness !== undefined || proof.p2pk_e !== undefined) {
    throw new Error("v0 does not support witnessed or P2PK proofs");
  }
  return {
    id: proof.id,
    amount,
    secret: proof.secret,
    C: proof.C,
    reserved: false,
    ...(proof.dleq ? { dleq: proof.dleq } : {}),
  };
}

function requirePositiveSafeAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function requireUsdMintQuote(quote: MintQuoteBolt11Response): void {
  if (quote.unit !== "usd") throw new Error("v0 requires a USD mint quote");
}

function requireUsdMeltQuote(quote: MeltQuoteBolt11Response): void {
  if (quote.unit !== "usd") throw new Error("v0 requires a USD melt quote");
}

function outputKey(output: SerializedBlindedMessage): string {
  return `${output.id}\u0000${output.amount.toString()}\u0000${output.B_}`;
}
