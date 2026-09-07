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
  decodeSerializedMeltPreviewV0,
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
  constructor(
    private readonly walletSource: Wallet | (() => Promise<Wallet>)
  ) {}

  private getWallet(): Promise<Wallet> {
    return typeof this.walletSource === "function"
      ? this.walletSource()
      : Promise.resolve(this.walletSource);
  }

  async createMintPreview(
    intent: MintOperationIntent
  ): Promise<SerializedMintPreviewV0> {
    const wallet = await this.getWallet();
    requirePositiveSafeAmount(intent.amount, "mint amount");
    requireUsdMintQuote(intent.quote);
    if (intent.quote.state !== MintQuoteState.PAID) {
      throw new Error("mint quote must be PAID before preparing outputs");
    }
    const preview = await wallet.prepareMint(
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
    const wallet = await this.getWallet();
    requireUsdMeltQuote(intent.quote);
    if (intent.quote.state !== MeltQuoteState.UNPAID) {
      throw new Error("melt quote must be UNPAID before preparing inputs");
    }
    if (intent.quote.request.startsWith("cashu-sync-demo:")) {
      const preview = await wallet.prepareSwapToSend(
        intent.quote.amount,
        intent.proofs,
        { includeFees: true, keysetId: intent.keysetId }
      );
      const serialized = serializeMeltPreviewV0({
        method: "bolt11",
        keysetId: preview.keysetId,
        quote: {
          ...intent.quote,
          fee_reserve: preview.fees,
          payment_preimage: null,
        },
        inputs: preview.inputs,
        outputData: [
          ...(preview.keepOutputs ?? []),
          ...(preview.sendOutputs ?? []),
        ],
      });
      return decodeSerializedMeltPreviewV0({
        ...serialized,
        method: "swap",
        keep_output_count: preview.keepOutputs?.length ?? 0,
      });
    }
    const target = intent.quote.amount.add(intent.quote.fee_reserve);
    const selected = wallet.selectProofsToSend(
      intent.proofs,
      target,
      true,
      false
    ).send;
    if (selected.length === 0) {
      throw new Error("no proofs selected for melt");
    }
    const preview = await wallet.prepareMelt("bolt11", intent.quote, selected, {
      keysetId: intent.keysetId,
    });
    return serializeMeltPreviewV0(preview, intent.preferAsync ?? false);
  }

  async submitMint(
    exactPreview: SerializedMintPreviewV0
  ): Promise<PendingMintResponseV0> {
    const wallet = await this.getWallet();
    const preview = deserializeMintPreviewV0(exactPreview);
    const proofs = await wallet.completeMint(preview);
    return { proofs: proofs.map(toSnapshotProof) };
  }

  async recreateMintPreview(
    exactPreview: SerializedMintPreviewV0
  ): Promise<SerializedMintPreviewV0> {
    const wallet = await this.getWallet();
    const exact = deserializeMintPreviewV0(exactPreview);
    const quote = await wallet.checkMintQuoteBolt11(exact.quote.quote);
    if (quote.state !== MintQuoteState.PAID) {
      throw new Error(`mint quote is ${quote.state}; cannot reprepare outputs`);
    }
    const preview = await wallet.prepareMint(
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
    const wallet = await this.getWallet();
    const exact = deserializeMeltPreviewV0(exactPreview);
    if (exactPreview.method === "swap") {
      const response = await wallet.mint.swap({
        inputs: exact.inputs,
        outputs: exact.outputData.map((output) => output.blindedMessage),
      });
      return this.swapResponse(exactPreview, response.signatures, wallet);
    }
    const response = await wallet.completeMelt(exact, undefined, {
      preferAsync: exactPreview.request.prefer_async,
    });
    return meltResponse(response.quote, response.change);
  }

  async reconcileMint(
    exactPreview: SerializedMintPreviewV0
  ): Promise<PendingMintResponseV0 | null> {
    const wallet = await this.getWallet();
    const exact = deserializeMintPreviewV0(exactPreview);
    let quote = await wallet.checkMintQuoteBolt11(exact.quote.quote);
    requireUsdMintQuote(quote);
    if (quote.state === MintQuoteState.PAID) {
      try {
        // Replay only the durable request; never allocate new outputs here.
        return await this.submitMint(exactPreview);
      } catch {
        // The original request or this retry may have issued before its reply
        // was lost. Recheck once and restore; never loop on an uncertain POST.
        quote = await wallet.checkMintQuoteBolt11(exact.quote.quote);
        requireUsdMintQuote(quote);
      }
    }
    if (quote.state !== MintQuoteState.ISSUED) return null;

    // NUT-09 is read-only: ask only for the exact blinded messages already
    // persisted before submission, then reconstruct proofs in prepared order.
    const restored = await wallet.mint.restore({
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
          outputData.toProof(signature, wallet.getKeyset(signature.id))
        )
      );
    }
    return { proofs };
  }

  private swapResponse(
    preview: SerializedMeltPreviewV0,
    signatures: import("@cashu/cashu-ts").SerializedBlindedSignature[],
    wallet: Wallet
  ): PendingMeltResponseV0 {
    const exact = deserializeMeltPreviewV0(preview);
    if (signatures.length !== exact.outputData.length)
      throw new Error("incomplete swap response");
    const proofs = exact.outputData.map((output, i) => {
      const signature = signatures[i];
      if (
        signature.id !== output.blindedMessage.id ||
        !signature.amount.equals(output.blindedMessage.amount)
      ) {
        throw new Error("swap signature does not match prepared output");
      }
      return toSnapshotProof(
        output.toProof(signature, wallet.getKeyset(signature.id))
      );
    });
    return {
      state: "PAID",
      payment_preimage: null,
      change: proofs.slice(0, preview.keep_output_count),
    };
  }

  async reconcileMelt(
    exactPreview: SerializedMeltPreviewV0
  ): Promise<PendingMeltResponseV0 | null> {
    const wallet = await this.getWallet();
    const exact = deserializeMeltPreviewV0(exactPreview);
    if (exactPreview.method === "swap") {
      const restored = await wallet.mint.restore({
        outputs: exact.outputData.map((o) => o.blindedMessage),
      });
      if (
        restored.outputs.length === exact.outputData.length &&
        restored.signatures.length === exact.outputData.length
      ) {
        const byOutput = new Map(
          restored.outputs.map((o, i) => [o.B_, restored.signatures[i]])
        );
        const signatures = exact.outputData.map((o) =>
          byOutput.get(o.blindedMessage.B_)
        );
        if (signatures.every((s) => s !== undefined))
          return this.swapResponse(exactPreview, signatures, wallet);
      }
      const states = await wallet.checkProofsStates(exact.inputs);
      if (
        states.length === exact.inputs.length &&
        states.every((s) => s.state === "UNSPENT")
      ) {
        return this.submitMelt(exactPreview);
      }
      return null;
    }
    const quote = await wallet.checkMeltQuoteBolt11(exact.quote.quote);
    requireUsdMeltQuote(quote);
    if (quote.state !== MeltQuoteState.PAID) {
      return meltResponse(quote, []);
    }
    const change = wallet.createMeltChangeProofs(
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
      quote.state === MeltQuoteState.PAID ? change.map(toSnapshotProof) : [],
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
