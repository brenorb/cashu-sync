import { createHash, randomBytes, randomUUID } from "node:crypto";
import { bech32 } from "bech32";
import { secp256k1 } from "@noble/curves/secp256k1";

export type ExternalMintQuote = {
  quote: string;
  request: string;
  amount: number;
  unit: "usd";
  state: string;
};

// Unique, signed invoices for the disposable FakeWallet backend. Nothing here
// connects to a real Lightning node or spends real funds.
function numberWords(value: number): number[] {
  const words: number[] = [];
  do {
    words.unshift(value % 32);
    value = Math.floor(value / 32);
  } while (value);
  return words;
}
function taggedBytes(type: number, bytes: Uint8Array): number[] {
  const words = bech32.toWords(bytes);
  return [type, Math.floor(words.length / 32), words.length % 32, ...words];
}
export async function createPayableUsdBolt11Invoice(
  amount: number
): Promise<ExternalMintQuote> {
  if (amount !== 100) throw new Error("the v0 test invoice is exactly 1 USD");
  const timestamp = numberWords(Math.floor(Date.now() / 1000));
  while (timestamp.length < 7) timestamp.unshift(0);
  const words = [
    ...timestamp,
    ...taggedBytes(1, randomBytes(32)),
    ...taggedBytes(16, randomBytes(32)),
    ...taggedBytes(13, Buffer.from("cashu-sync disposable test invoice")),
    6,
    0,
    3,
    ...numberWords(3600),
  ];
  // BOLT11 hashes the HRP followed by data padded to a byte boundary.
  let accumulator = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const word of words) {
    accumulator = (accumulator << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  if (bits) bytes.push((accumulator << (8 - bits)) & 255);
  const prefix = "lnbc13350n";
  const hash = createHash("sha256")
    .update(Buffer.concat([Buffer.from(prefix), Buffer.from(bytes)]))
    .digest();
  const signature = secp256k1.sign(hash, randomBytes(32));
  const signatureWords = bech32.toWords(
    Buffer.concat([
      Buffer.from(signature.toCompactRawBytes()),
      Buffer.from([signature.recovery]),
    ])
  );
  return {
    quote: `cashu-sync-e2e-${randomUUID()}`,
    request: bech32.encode(prefix, [...words, ...signatureWords], 5000),
    amount: 100,
    unit: "usd",
    state: "UNPAID",
  };
}
