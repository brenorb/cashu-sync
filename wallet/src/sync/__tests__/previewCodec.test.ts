import { describe, expect, it } from "vitest";
import {
  Amount,
  MeltQuoteState,
  MintQuoteState,
  OutputData,
  type MeltPreview,
  type MeltQuoteBolt11Response,
  type MintPreview,
  type MintQuoteBolt11Response,
} from "@cashu/cashu-ts";
import {
  deserializeMeltPreviewV0,
  deserializeMintPreviewV0,
  serializeMeltPreviewV0,
  serializeMintPreviewV0,
} from "src/sync/previewCodec";

function output(amount: number, marker: number) {
  return new OutputData(
    {
      amount: Amount.from(amount),
      B_: `02${marker.toString(16).padStart(64, "0")}`,
      id: "00c0ffee",
    },
    BigInt(marker),
    Uint8Array.from([marker])
  );
}

describe("Cashu preview codec", () => {
  it("round-trips a mint preview with the complete ordered request", () => {
    const outputs = [output(10, 1), output(20, 2)];
    const quote: MintQuoteBolt11Response = {
      quote: "mint-q",
      request: "lnbc1mint",
      amount: Amount.from(30),
      unit: "usd",
      state: MintQuoteState.PAID,
      expiry: 1780000200,
    };
    const preview: MintPreview<MintQuoteBolt11Response> = {
      method: "bolt11",
      keysetId: "00c0ffee",
      quote,
      payload: {
        quote: quote.quote,
        outputs: outputs.map((o) => o.blindedMessage),
        signature: "nut20-signature",
      },
      outputData: outputs,
      legacySignature: "legacy-signature",
    };

    const serialized = serializeMintPreviewV0(preview);
    expect(serialized.request.outputs.map((o) => o.amount)).toEqual([
      "10",
      "20",
    ]);
    expect(serialized.request.signature).toBe("nut20-signature");

    const restored = deserializeMintPreviewV0(serialized);
    expect(restored.payload.outputs.map((o) => o.amount.toString())).toEqual([
      "10",
      "20",
    ]);
    expect(restored.outputData.map((o) => OutputData.serialize(o))).toEqual(
      serialized.output_data
    );
    expect(restored.legacySignature).toBe("legacy-signature");
  });

  it("round-trips a melt preview with inputs and outputs in exact order", () => {
    const outputs = [output(0, 3), output(0, 4)];
    const quote: MeltQuoteBolt11Response = {
      quote: "melt-q",
      request: "lnbc1melt",
      amount: Amount.from(25),
      fee_reserve: Amount.from(5),
      unit: "usd",
      state: MeltQuoteState.UNPAID,
      expiry: 1780000300,
      payment_preimage: null,
    };
    const preview: MeltPreview<MeltQuoteBolt11Response> = {
      method: "bolt11",
      keysetId: "00c0ffee",
      quote,
      inputs: [
        { id: "00c0ffee", amount: Amount.from(10), secret: "first", C: "02aa" },
        {
          id: "00c0ffee",
          amount: Amount.from(20),
          secret: "second",
          C: "02bb",
        },
      ],
      outputData: outputs,
    };

    const serialized = serializeMeltPreviewV0(preview, true);
    expect(serialized.request.prefer_async).toBe(true);
    expect(serialized.request.inputs.map((p) => p.secret)).toEqual([
      "first",
      "second",
    ]);
    expect(serialized.request.outputs.map((o) => o.B_)).toEqual(
      outputs.map((o) => o.blindedMessage.B_)
    );

    const restored = deserializeMeltPreviewV0(serialized);
    expect(restored.inputs.map((p) => p.secret)).toEqual(["first", "second"]);
    expect(restored.outputData.map((o) => OutputData.serialize(o))).toEqual(
      serialized.output_data
    );
  });

  it("records an explicit false prefer_async default", () => {
    const quote: MeltQuoteBolt11Response = {
      quote: "melt-q",
      request: "lnbc1melt",
      amount: Amount.from(1),
      fee_reserve: Amount.from(0),
      unit: "usd",
      state: MeltQuoteState.UNPAID,
      expiry: 1780000300,
      payment_preimage: null,
    };
    const serialized = serializeMeltPreviewV0({
      method: "bolt11",
      keysetId: "00c0ffee",
      quote,
      inputs: [
        { id: "00c0ffee", amount: Amount.from(1), secret: "one", C: "02aa" },
      ],
      outputData: [],
    });
    expect(serialized.request.prefer_async).toBe(false);

    const withoutPreferAsync = JSON.parse(JSON.stringify(serialized));
    delete withoutPreferAsync.request.prefer_async;
    expect(() => deserializeMeltPreviewV0(withoutPreferAsync)).toThrow(
      /prefer_async/
    );
  });

  it("rejects reordered request material that no longer matches output data", () => {
    const outputData = [output(10, 1), output(20, 2)];
    const quote: MintQuoteBolt11Response = {
      quote: "mint-q",
      request: "lnbc1mint",
      amount: Amount.from(30),
      unit: "usd",
      state: MintQuoteState.PAID,
      expiry: null,
    };
    const serialized = serializeMintPreviewV0({
      method: "bolt11",
      keysetId: "00c0ffee",
      quote,
      payload: {
        quote: quote.quote,
        outputs: outputData.map((o) => o.blindedMessage),
      },
      outputData,
    });
    serialized.request.outputs.reverse();
    expect(() => deserializeMintPreviewV0(serialized)).toThrow(/ordered/i);
  });
});
