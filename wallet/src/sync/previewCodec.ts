import {
  Amount,
  OutputData,
  type MeltPreview,
  type MeltQuoteBolt11Response,
  type MintPreview,
  type MintQuoteBolt11Response,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
} from "@cashu/cashu-ts";
import type {
  DleqV0,
  OrderedBlindedMessageV0,
  OrderedBlindedSignatureV0,
  OrderedProofV0,
  SerializedMeltPreviewV0,
  SerializedMeltQuoteV0,
  SerializedMintPreviewV0,
  SerializedMintQuoteV0,
  SerializedOutputDataV0,
} from "./types";
import {
  arrayValue,
  booleanValue,
  canonicalJson,
  decimalAmount,
  enumValue,
  exactKeys,
  fail,
  record,
  safeInteger,
  stringValue,
} from "./validation";

const MINT_STATES = ["UNPAID", "PAID", "ISSUED"] as const;
const MELT_STATES = ["UNPAID", "PENDING", "PAID"] as const;

function serializeDleq(dleq: DleqV0 | undefined): DleqV0 | undefined {
  if (!dleq) return undefined;
  return { e: dleq.e, s: dleq.s, ...(dleq.r ? { r: dleq.r } : {}) };
}

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

function serializeBlindedMessage(
  message: SerializedBlindedMessage
): OrderedBlindedMessageV0 {
  return {
    amount: message.amount.toString(),
    B_: message.B_,
    id: message.id,
  };
}

function decodeBlindedMessage(
  value: unknown,
  path: string
): OrderedBlindedMessageV0 {
  const input = record(value, path);
  exactKeys(input, ["amount", "B_", "id"], [], path);
  return {
    amount: decimalAmount(input.amount, `${path}.amount`),
    B_: stringValue(input.B_, `${path}.B_`, { min: 1, max: 1024 }),
    id: stringValue(input.id, `${path}.id`, { min: 1, max: 256 }),
  };
}

function deserializeBlindedMessage(
  message: OrderedBlindedMessageV0
): SerializedBlindedMessage {
  return {
    amount: Amount.from(message.amount),
    B_: message.B_,
    id: message.id,
  };
}

function serializeBlindedSignature(
  signature: SerializedBlindedSignature
): OrderedBlindedSignatureV0 {
  return {
    amount: signature.amount.toString(),
    C_: signature.C_,
    id: signature.id,
    ...(signature.dleq ? { dleq: serializeDleq(signature.dleq) } : {}),
  };
}

function decodeBlindedSignature(
  value: unknown,
  path: string
): OrderedBlindedSignatureV0 {
  const input = record(value, path);
  exactKeys(input, ["amount", "C_", "id"], ["dleq"], path);
  return {
    amount: decimalAmount(input.amount, `${path}.amount`),
    C_: stringValue(input.C_, `${path}.C_`, { min: 1, max: 1024 }),
    id: stringValue(input.id, `${path}.id`, { min: 1, max: 256 }),
    ...(input.dleq === undefined
      ? {}
      : { dleq: decodeDleq(input.dleq, `${path}.dleq`) }),
  };
}

function deserializeBlindedSignature(
  signature: OrderedBlindedSignatureV0
): SerializedBlindedSignature {
  return {
    amount: Amount.from(signature.amount),
    C_: signature.C_,
    id: signature.id,
    ...(signature.dleq ? { dleq: signature.dleq } : {}),
  };
}

function serializeProof(proof: Proof): OrderedProofV0 {
  if (proof.witness !== undefined || proof.p2pk_e !== undefined) {
    fail(
      "preview.request.inputs",
      "v0 does not support witnessed or P2PK proofs"
    );
  }
  return {
    id: proof.id,
    amount: proof.amount.toString(),
    secret: proof.secret,
    C: proof.C,
    ...(proof.dleq ? { dleq: serializeDleq(proof.dleq) } : {}),
  };
}

function decodeProof(value: unknown, path: string): OrderedProofV0 {
  const input = record(value, path);
  exactKeys(input, ["id", "amount", "secret", "C"], ["dleq"], path);
  return {
    id: stringValue(input.id, `${path}.id`, { min: 1, max: 256 }),
    amount: decimalAmount(input.amount, `${path}.amount`),
    secret: stringValue(input.secret, `${path}.secret`, {
      min: 1,
      max: 4096,
    }),
    C: stringValue(input.C, `${path}.C`, { min: 1, max: 1024 }),
    ...(input.dleq === undefined
      ? {}
      : { dleq: decodeDleq(input.dleq, `${path}.dleq`) }),
  };
}

function deserializeProof(proof: OrderedProofV0): Proof {
  return {
    id: proof.id,
    amount: Amount.from(proof.amount),
    secret: proof.secret,
    C: proof.C,
    ...(proof.dleq ? { dleq: proof.dleq } : {}),
  };
}

function decodeOutputData(
  value: unknown,
  path: string
): SerializedOutputDataV0 {
  const input = record(value, path);
  exactKeys(
    input,
    ["blindedMessage", "blindingFactor", "secret"],
    ["ephemeralE"],
    path
  );
  return {
    blindedMessage: decodeBlindedMessage(
      input.blindedMessage,
      `${path}.blindedMessage`
    ),
    // cashu-ts stores blinding factors as arbitrary 256-bit integers; they
    // are not wallet-denominated amounts and may exceed the amount codec's
    // 20-digit bound.
    blindingFactor: stringValue(input.blindingFactor, `${path}.blindingFactor`, {
      min: 1,
      max: 78,
      pattern: /^(0|[1-9]\d*)$/,
    }),
    secret: stringValue(input.secret, `${path}.secret`, {
      min: 2,
      max: 8192,
      pattern: /^(?:[0-9a-fA-F]{2})+$/,
    }).toLowerCase(),
    ...(input.ephemeralE === undefined
      ? {}
      : {
          ephemeralE: stringValue(input.ephemeralE, `${path}.ephemeralE`, {
            min: 2,
            max: 1024,
            pattern: /^[0-9a-fA-F]+$/,
          }).toLowerCase(),
        }),
  };
}

function serializeMintQuote(
  quote: MintQuoteBolt11Response
): SerializedMintQuoteV0 {
  if (quote.unit !== "usd") fail("preview.quote.unit", "v0 requires usd");
  return {
    quote: quote.quote,
    request: quote.request,
    amount: quote.amount.toString(),
    unit: "usd",
    state: quote.state,
    expiry: quote.expiry,
    ...(quote.pubkey ? { pubkey: quote.pubkey } : {}),
  };
}

function decodeMintQuote(value: unknown, path: string): SerializedMintQuoteV0 {
  const input = record(value, path);
  exactKeys(
    input,
    ["quote", "request", "amount", "unit", "state", "expiry"],
    ["pubkey"],
    path
  );
  if (input.unit !== "usd") fail(`${path}.unit`, "v0 requires usd");
  return {
    quote: stringValue(input.quote, `${path}.quote`, { min: 1, max: 4096 }),
    request: stringValue(input.request, `${path}.request`, {
      min: 1,
      max: 16_384,
    }),
    amount: decimalAmount(input.amount, `${path}.amount`),
    unit: "usd",
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

function deserializeMintQuote(
  quote: SerializedMintQuoteV0
): MintQuoteBolt11Response {
  return {
    ...quote,
    amount: Amount.from(quote.amount),
  };
}

function serializeMeltQuote(
  quote: MeltQuoteBolt11Response
): SerializedMeltQuoteV0 {
  if (quote.unit !== "usd") fail("preview.quote.unit", "v0 requires usd");
  return {
    quote: quote.quote,
    request: quote.request,
    amount: quote.amount.toString(),
    fee_reserve: quote.fee_reserve.toString(),
    unit: "usd",
    state: quote.state,
    expiry: quote.expiry,
    payment_preimage: quote.payment_preimage,
    ...(quote.change
      ? { change: quote.change.map(serializeBlindedSignature) }
      : {}),
  };
}

function decodeMeltQuote(value: unknown, path: string): SerializedMeltQuoteV0 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "quote",
      "request",
      "amount",
      "fee_reserve",
      "unit",
      "state",
      "expiry",
      "payment_preimage",
    ],
    ["change"],
    path
  );
  if (input.unit !== "usd") fail(`${path}.unit`, "v0 requires usd");
  return {
    quote: stringValue(input.quote, `${path}.quote`, { min: 1, max: 4096 }),
    request: stringValue(input.request, `${path}.request`, {
      min: 1,
      max: 16_384,
    }),
    amount: decimalAmount(input.amount, `${path}.amount`),
    fee_reserve: decimalAmount(input.fee_reserve, `${path}.fee_reserve`),
    unit: "usd",
    state: enumValue(input.state, MELT_STATES, `${path}.state`),
    expiry: safeInteger(input.expiry, `${path}.expiry`),
    payment_preimage:
      input.payment_preimage === null
        ? null
        : stringValue(input.payment_preimage, `${path}.payment_preimage`, {
            max: 4096,
          }),
    ...(input.change === undefined
      ? {}
      : {
          change: arrayValue(input.change, `${path}.change`).map(
            (entry, index) =>
              decodeBlindedSignature(entry, `${path}.change[${index}]`)
          ),
        }),
  };
}

function deserializeMeltQuote(
  quote: SerializedMeltQuoteV0
): MeltQuoteBolt11Response {
  const { change, ...rest } = quote;
  return {
    ...rest,
    amount: Amount.from(quote.amount),
    fee_reserve: Amount.from(quote.fee_reserve),
    ...(change ? { change: change.map(deserializeBlindedSignature) } : {}),
  };
}

function assertOutputOrder(
  request: OrderedBlindedMessageV0[],
  outputData: SerializedOutputDataV0[],
  path: string
) {
  const fromOutputData = outputData.map((entry) => entry.blindedMessage);
  if (canonicalJson(request) !== canonicalJson(fromOutputData)) {
    fail(path, "ordered request outputs do not match ordered output data");
  }
}

export function decodeSerializedMintPreviewV0(
  value: unknown,
  path = "preview"
): SerializedMintPreviewV0 {
  const input = record(value, path);
  exactKeys(
    input,
    ["method", "keyset_id", "quote", "request", "output_data"],
    ["legacy_signature"],
    path
  );
  if (input.method !== "bolt11") fail(`${path}.method`, "v0 requires bolt11");
  const keysetId = stringValue(input.keyset_id, `${path}.keyset_id`, {
    min: 1,
    max: 256,
  });
  const quote = decodeMintQuote(input.quote, `${path}.quote`);
  const request = record(input.request, `${path}.request`);
  exactKeys(request, ["quote", "outputs"], ["signature"], `${path}.request`);
  const orderedRequest = {
    quote: stringValue(request.quote, `${path}.request.quote`, {
      min: 1,
      max: 4096,
    }),
    outputs: arrayValue(request.outputs, `${path}.request.outputs`).map(
      (entry, index) =>
        decodeBlindedMessage(entry, `${path}.request.outputs[${index}]`)
    ),
    ...(request.signature === undefined
      ? {}
      : {
          signature: stringValue(
            request.signature,
            `${path}.request.signature`,
            {
              min: 1,
              max: 4096,
            }
          ),
        }),
  };
  const outputData = arrayValue(input.output_data, `${path}.output_data`).map(
    (entry, index) => decodeOutputData(entry, `${path}.output_data[${index}]`)
  );
  if (orderedRequest.quote !== quote.quote) {
    fail(`${path}.request.quote`, "does not match quote object");
  }
  if (orderedRequest.outputs.some((output) => output.id !== keysetId)) {
    fail(`${path}.request.outputs`, "output keyset does not match keyset_id");
  }
  assertOutputOrder(
    orderedRequest.outputs,
    outputData,
    `${path}.request.outputs`
  );
  return {
    method: "bolt11",
    keyset_id: keysetId,
    quote,
    request: orderedRequest,
    output_data: outputData,
    ...(input.legacy_signature === undefined
      ? {}
      : {
          legacy_signature: stringValue(
            input.legacy_signature,
            `${path}.legacy_signature`,
            { min: 1, max: 4096 }
          ),
        }),
  };
}

export function decodeSerializedMeltPreviewV0(
  value: unknown,
  path = "preview"
): SerializedMeltPreviewV0 {
  const input = record(value, path);
  exactKeys(
    input,
    ["method", "keyset_id", "quote", "request", "output_data"],
    [],
    path
  );
  if (input.method !== "bolt11") fail(`${path}.method`, "v0 requires bolt11");
  const keysetId = stringValue(input.keyset_id, `${path}.keyset_id`, {
    min: 1,
    max: 256,
  });
  const quote = decodeMeltQuote(input.quote, `${path}.quote`);
  const request = record(input.request, `${path}.request`);
  exactKeys(
    request,
    ["quote", "inputs", "outputs", "prefer_async"],
    [],
    `${path}.request`
  );
  const orderedRequest = {
    quote: stringValue(request.quote, `${path}.request.quote`, {
      min: 1,
      max: 4096,
    }),
    inputs: arrayValue(request.inputs, `${path}.request.inputs`).map(
      (entry, index) => decodeProof(entry, `${path}.request.inputs[${index}]`)
    ),
    outputs: arrayValue(request.outputs, `${path}.request.outputs`).map(
      (entry, index) =>
        decodeBlindedMessage(entry, `${path}.request.outputs[${index}]`)
    ),
    prefer_async: booleanValue(
      request.prefer_async,
      `${path}.request.prefer_async`
    ),
  };
  const outputData = arrayValue(input.output_data, `${path}.output_data`).map(
    (entry, index) => decodeOutputData(entry, `${path}.output_data[${index}]`)
  );
  if (orderedRequest.quote !== quote.quote) {
    fail(`${path}.request.quote`, "does not match quote object");
  }
  if (orderedRequest.outputs.some((output) => output.id !== keysetId)) {
    fail(`${path}.request.outputs`, "output keyset does not match keyset_id");
  }
  assertOutputOrder(
    orderedRequest.outputs,
    outputData,
    `${path}.request.outputs`
  );
  return {
    method: "bolt11",
    keyset_id: keysetId,
    quote,
    request: orderedRequest,
    output_data: outputData,
  };
}

export function serializeMintPreviewV0(
  preview: MintPreview<MintQuoteBolt11Response>
): SerializedMintPreviewV0 {
  return decodeSerializedMintPreviewV0({
    method: preview.method,
    keyset_id: preview.keysetId,
    quote: serializeMintQuote(preview.quote),
    request: {
      quote: preview.payload.quote,
      outputs: preview.payload.outputs.map(serializeBlindedMessage),
      ...(preview.payload.signature
        ? { signature: preview.payload.signature }
        : {}),
    },
    output_data: preview.outputData.map((entry) => OutputData.serialize(entry)),
    ...(preview.legacySignature
      ? { legacy_signature: preview.legacySignature }
      : {}),
  });
}

export function deserializeMintPreviewV0(
  value: unknown
): MintPreview<MintQuoteBolt11Response> {
  const preview = decodeSerializedMintPreviewV0(value);
  return {
    method: "bolt11",
    keysetId: preview.keyset_id,
    quote: deserializeMintQuote(preview.quote),
    payload: {
      quote: preview.request.quote,
      outputs: preview.request.outputs.map(deserializeBlindedMessage),
      ...(preview.request.signature
        ? { signature: preview.request.signature }
        : {}),
    },
    outputData: preview.output_data.map((entry) =>
      OutputData.deserialize(entry)
    ),
    ...(preview.legacy_signature
      ? { legacySignature: preview.legacy_signature }
      : {}),
  };
}

export function serializeMeltPreviewV0(
  preview: MeltPreview<MeltQuoteBolt11Response>,
  preferAsync = false
): SerializedMeltPreviewV0 {
  return decodeSerializedMeltPreviewV0({
    method: preview.method,
    keyset_id: preview.keysetId,
    quote: serializeMeltQuote(preview.quote),
    request: {
      quote: preview.quote.quote,
      inputs: preview.inputs.map(serializeProof),
      outputs: preview.outputData.map((entry) =>
        serializeBlindedMessage(entry.blindedMessage)
      ),
      prefer_async: preferAsync,
    },
    output_data: preview.outputData.map((entry) => OutputData.serialize(entry)),
  });
}

export function deserializeMeltPreviewV0(
  value: unknown
): MeltPreview<MeltQuoteBolt11Response> {
  const preview = decodeSerializedMeltPreviewV0(value);
  return {
    method: "bolt11",
    keysetId: preview.keyset_id,
    quote: deserializeMeltQuote(preview.quote),
    inputs: preview.request.inputs.map(deserializeProof),
    outputData: preview.output_data.map((entry) =>
      OutputData.deserialize(entry)
    ),
  };
}
