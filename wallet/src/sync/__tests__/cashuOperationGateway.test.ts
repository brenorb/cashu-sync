import { describe, expect, it, vi } from "vitest";
import {
  Amount,
  MeltQuoteState,
  MintQuoteState,
  OutputData,
  type MeltPreview,
  type MeltQuoteBolt11Response,
  type MintPreview,
  type MintQuoteBolt11Response,
  type Proof,
  type Wallet,
} from "@cashu/cashu-ts";
import {
  CashuTsOperationGateway,
  type MeltOperationIntent,
  type MintOperationIntent,
} from "src/sync/cashuOperationGateway";
import {
  serializeMeltPreviewV0,
  serializeMintPreviewV0,
} from "src/sync/previewCodec";

const KEYSET = "00c0ffee";

function output(amount: number, marker: number) {
  return new OutputData(
    {
      amount: Amount.from(amount),
      B_: `02${marker.toString(16).padStart(64, "0")}`,
      id: KEYSET,
    },
    BigInt(marker),
    Uint8Array.from([marker])
  );
}

function proof(amount: number, marker: string): Proof {
  return {
    id: KEYSET,
    amount: Amount.from(amount),
    secret: marker,
    C: `02${marker.padStart(64, "0")}`,
  };
}

function snapshotProof(amount: number, marker: string) {
  return {
    id: KEYSET,
    amount,
    secret: marker,
    C: `02${marker.padStart(64, "0")}`,
    reserved: false,
  };
}

function mintQuote(state = MintQuoteState.PAID): MintQuoteBolt11Response {
  return {
    quote: "mint-q",
    request: "lnbc1mint",
    amount: Amount.from(30),
    unit: "usd",
    state,
    expiry: 1_800_000_000,
  };
}

function meltQuote(state = MeltQuoteState.UNPAID): MeltQuoteBolt11Response {
  return {
    quote: "melt-q",
    request: "lnbc1melt",
    amount: Amount.from(25),
    fee_reserve: Amount.from(5),
    unit: "usd",
    state,
    expiry: 1_800_000_000,
    payment_preimage: state === MeltQuoteState.PAID ? "preimage" : null,
  };
}

function walletMock(overrides: Record<string, unknown> = {}): Wallet {
  return {
    prepareMint: vi.fn(),
    completeMint: vi.fn(),
    prepareMelt: vi.fn(),
    completeMelt: vi.fn(),
    selectProofsToSend: vi.fn(),
    checkMintQuoteBolt11: vi.fn(),
    checkMeltQuoteBolt11: vi.fn(),
    createMeltChangeProofs: vi.fn(),
    getKeyset: vi.fn(() => ({ id: KEYSET })),
    mint: { restore: vi.fn() },
    ...overrides,
  } as unknown as Wallet;
}

describe("CashuTsOperationGateway", () => {
  it("prepares a mint once and serializes its exact output order", async () => {
    const outputs = [output(10, 1), output(20, 2)];
    const quote = mintQuote();
    const preview: MintPreview<MintQuoteBolt11Response> = {
      method: "bolt11",
      keysetId: KEYSET,
      quote,
      payload: { quote: quote.quote, outputs: outputs.map((o) => o.blindedMessage) },
      outputData: outputs,
    };
    const prepareMint = vi.fn(async () => preview);
    const wallet = walletMock({ prepareMint });
    const gateway = new CashuTsOperationGateway(wallet);
    const intent: MintOperationIntent = { amount: 30, quote, keysetId: KEYSET };

    const exact = await gateway.createMintPreview(intent);

    expect(prepareMint).toHaveBeenCalledWith("bolt11", 30, quote, {
      keysetId: KEYSET,
    });
    expect(exact.request.outputs.map((entry) => entry.amount)).toEqual([
      "10",
      "20",
    ]);
  });

  it("selects melt inputs offline and never calls send or swap", async () => {
    const quote = meltQuote();
    const selected = [proof(10, "one"), proof(20, "two")];
    const preview: MeltPreview<MeltQuoteBolt11Response> = {
      method: "bolt11",
      keysetId: KEYSET,
      quote,
      inputs: selected,
      outputData: [output(0, 3)],
    };
    const selectProofsToSend = vi.fn(() => ({ keep: [], send: selected }));
    const prepareMelt = vi.fn(async () => preview);
    const send = vi.fn();
    const swap = vi.fn();
    const wallet = walletMock({
      selectProofsToSend,
      prepareMelt,
      send,
      swap,
    });
    const gateway = new CashuTsOperationGateway(wallet);
    const intent: MeltOperationIntent = {
      quote,
      proofs: [snapshotProof(10, "one"), snapshotProof(20, "two")],
      keysetId: KEYSET,
      preferAsync: true,
    };

    const exact = await gateway.createMeltPreview(intent);

    expect(selectProofsToSend).toHaveBeenCalledWith(
      intent.proofs,
      Amount.from(30),
      true,
      false
    );
    expect(prepareMelt).toHaveBeenCalledWith(
      "bolt11",
      quote,
      selected,
      { keysetId: KEYSET }
    );
    expect(exact.request.prefer_async).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();
  });

  it("submits the exact mint preview and converts returned proofs", async () => {
    const outputs = [output(10, 1), output(20, 2)];
    const quote = mintQuote();
    const preview = serializeMintPreviewV0({
      method: "bolt11",
      keysetId: KEYSET,
      quote,
      payload: { quote: quote.quote, outputs: outputs.map((o) => o.blindedMessage) },
      outputData: outputs,
    });
    const completeMint = vi.fn(async () => [proof(10, "01"), proof(20, "02")]);
    const gateway = new CashuTsOperationGateway(walletMock({ completeMint }));

    const response = await gateway.submitMint(preview);

    expect(completeMint).toHaveBeenCalledOnce();
    expect(response.proofs).toEqual([
      snapshotProof(10, "01"),
      snapshotProof(20, "02"),
    ]);
  });

  it("submits a melt with the persisted prefer_async flag", async () => {
    const quote = meltQuote();
    const preview = serializeMeltPreviewV0(
      {
        method: "bolt11",
        keysetId: KEYSET,
        quote,
        inputs: [proof(30, "input")],
        outputData: [output(0, 3)],
      },
      true
    );
    const completeMelt = vi.fn(async () => ({
      quote: { ...quote, state: MeltQuoteState.PAID, payment_preimage: "preimage" },
      change: [proof(5, "03")],
      outputData: [],
    }));
    const gateway = new CashuTsOperationGateway(walletMock({ completeMelt }));

    const response = await gateway.submitMelt(preview);

    expect(completeMelt).toHaveBeenCalledWith(
      expect.objectContaining({ method: "bolt11" }),
      undefined,
      { preferAsync: true }
    );
    expect(response).toEqual({
      state: "PAID",
      payment_preimage: "preimage",
      change: [snapshotProof(5, "03")],
    });
  });

  it("recovers an issued mint only from the exact prepared NUT-09 outputs", async () => {
    const outputs = [output(10, 1), output(20, 2)];
    const quote = mintQuote();
    const preview = serializeMintPreviewV0({
      method: "bolt11",
      keysetId: KEYSET,
      quote,
      payload: { quote: quote.quote, outputs: outputs.map((o) => o.blindedMessage) },
      outputData: outputs,
    });
    const recoveredProofs = [proof(10, "01"), proof(20, "02")];
    const signatures = [
      { amount: Amount.from(10), id: KEYSET, C_: "02aa" },
      { amount: Amount.from(20), id: KEYSET, C_: "02bb" },
    ];
    vi.spyOn(OutputData.prototype, "toProof").mockImplementation(function () {
      return this.blindedMessage.amount.toNumber() === 10
        ? recoveredProofs[0]!
        : recoveredProofs[1]!;
    });
    const restore = vi.fn(async () => ({
      outputs: outputs.map((entry) => entry.blindedMessage),
      signatures,
    }));
    const wallet = walletMock({
      checkMintQuoteBolt11: vi.fn(async () => mintQuote(MintQuoteState.ISSUED)),
      mint: { restore },
    });
    const gateway = new CashuTsOperationGateway(wallet);

    const response = await gateway.reconcileMint(preview);

    expect(restore).toHaveBeenCalledWith({ outputs: preview.request.outputs.map((entry) => ({
      ...entry,
      amount: Amount.from(entry.amount),
    })) });
    expect(response?.proofs).toEqual([
      snapshotProof(10, "01"),
      snapshotProof(20, "02"),
    ]);
  });

  it("does not claim mint recovery when only some outputs are restored", async () => {
    const outputs = [output(10, 1), output(20, 2)];
    const quote = mintQuote();
    const preview = serializeMintPreviewV0({
      method: "bolt11",
      keysetId: KEYSET,
      quote,
      payload: { quote: quote.quote, outputs: outputs.map((o) => o.blindedMessage) },
      outputData: outputs,
    });
    const wallet = walletMock({
      checkMintQuoteBolt11: vi.fn(async () => mintQuote(MintQuoteState.ISSUED)),
      mint: {
        restore: vi.fn(async () => ({
          outputs: [outputs[0]!.blindedMessage],
          signatures: [{ amount: Amount.from(10), id: KEYSET, C_: "02aa" }],
        })),
      },
    });

    await expect(
      new CashuTsOperationGateway(wallet).reconcileMint(preview)
    ).resolves.toBeNull();
  });

  it.each([MeltQuoteState.UNPAID, MeltQuoteState.PENDING])(
    "reconciles %s melt state read-only without change",
    async (state) => {
      const quote = meltQuote();
      const preview = serializeMeltPreviewV0({
        method: "bolt11",
        keysetId: KEYSET,
        quote,
        inputs: [proof(30, "input")],
        outputData: [output(0, 3)],
      });
      const wallet = walletMock({
        checkMeltQuoteBolt11: vi.fn(async () => meltQuote(state)),
      });

      await expect(
        new CashuTsOperationGateway(wallet).reconcileMelt(preview)
      ).resolves.toEqual({
        state,
        payment_preimage: null,
        change: [],
      });
      expect(wallet.createMeltChangeProofs).not.toHaveBeenCalled();
    }
  );

  it("reconstructs paid melt change from the persisted output data", async () => {
    const quote = meltQuote();
    const preview = serializeMeltPreviewV0({
      method: "bolt11",
      keysetId: KEYSET,
      quote,
      inputs: [proof(30, "input")],
      outputData: [output(0, 3)],
    });
    const paid = {
      ...meltQuote(MeltQuoteState.PAID),
      change: [{ amount: Amount.from(5), id: KEYSET, C_: "02change" }],
    };
    const createMeltChangeProofs = vi.fn(() => [proof(5, "03")]);
    const wallet = walletMock({
      checkMeltQuoteBolt11: vi.fn(async () => paid),
      createMeltChangeProofs,
    });

    const response = await new CashuTsOperationGateway(wallet).reconcileMelt(
      preview
    );

    expect(createMeltChangeProofs).toHaveBeenCalledOnce();
    expect(response).toEqual({
      state: "PAID",
      payment_preimage: "preimage",
      change: [snapshotProof(5, "03")],
    });
  });
});
