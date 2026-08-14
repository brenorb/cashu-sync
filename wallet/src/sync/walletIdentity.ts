import { wordlist } from "@scure/bip39/wordlists/english";
import { hexToBytes } from "./syncCrypto";

const SYNC_SECRET = /^[0-9a-f]{64}$/;
const DOMAIN = "cashu-sync-wallet-id-v0\0";

/** Human-readable fingerprint; these words are not a recovery phrase. */
export async function deriveWalletIdWords(
  syncSecret: string
): Promise<string[]> {
  if (!SYNC_SECRET.test(syncSecret)) throw new Error("invalid sync secret");
  const secret = hexToBytes(syncSecret);
  const domain = new TextEncoder().encode(DOMAIN);
  const input = new Uint8Array(domain.length + secret.length);
  input.set(domain);
  input.set(secret, domain.length);
  secret.fill(0);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  input.fill(0);

  const words: string[] = [];
  let bit = 0;
  for (let word = 0; word < 6; word += 1) {
    let index = 0;
    for (let offset = 0; offset < 11; offset += 1) {
      const byte = digest[Math.floor(bit / 8)] ?? 0;
      index = (index << 1) | ((byte >> (7 - (bit % 8))) & 1);
      bit += 1;
    }
    words.push(wordlist[index]);
  }
  digest.fill(0);
  return words;
}
