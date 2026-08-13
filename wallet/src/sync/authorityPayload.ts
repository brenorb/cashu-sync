import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "./syncCrypto";
import {
  SyncValidationError,
  exactKeys,
  fail,
  record,
  safeInteger,
  stringValue,
} from "./validation";

export type AuthorityPayloadV0 = {
  schema: 0;
  mnemonic: string;
  sync_secret: string;
  mint_url: string;
  relay_url: string;
  head_event_id: string;
};

export type AuthorityValidationOptions = {
  allowLoopbackHttp?: boolean;
};

const HEAD_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function endpoint(
  value: unknown,
  path: string,
  secureProtocol: "https:" | "wss:",
  options: AuthorityValidationOptions,
  originOnly = false
): string {
  const raw = stringValue(value, path, { min: 1, max: 2048 });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(path, "invalid URL");
  }
  const insecureProtocol = secureProtocol === "https:" ? "http:" : "ws:";
  const loopbackAllowed =
    options.allowLoopbackHttp === true &&
    url.protocol === insecureProtocol &&
    LOOPBACK.has(url.hostname.toLowerCase());
  if (url.protocol !== secureProtocol && !loopbackAllowed) {
    fail(path, `requires ${secureProtocol.slice(0, -1)}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail(path, "cannot contain credentials, query, or fragment");
  }
  if (originOnly && url.pathname !== "/") {
    fail(path, "must be an origin without a path");
  }
  return raw.replace(/\/+$/, "");
}

export function decodeAuthorityPayloadV0(
  value: unknown,
  options: AuthorityValidationOptions = {},
  path = "authority"
): AuthorityPayloadV0 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "schema",
      "mnemonic",
      "sync_secret",
      "mint_url",
      "relay_url",
      "head_event_id",
    ],
    [],
    path
  );
  if (input.schema !== 0) fail(`${path}.schema`, "unsupported schema");
  const mnemonic = stringValue(input.mnemonic, `${path}.mnemonic`, {
    min: 1,
    max: 512,
  });
  if (
    mnemonic.split(" ").length !== 12 ||
    !validateMnemonic(mnemonic, wordlist)
  ) {
    fail(
      `${path}.mnemonic`,
      "expected a valid twelve-word English BIP39 mnemonic"
    );
  }
  const syncSecret = stringValue(input.sync_secret, `${path}.sync_secret`, {
    min: 64,
    max: 64,
    pattern: SECRET_PATTERN,
  });
  const syncSecretBytes = hexToBytes(syncSecret);
  try {
    getPublicKey(syncSecretBytes);
  } catch {
    fail(`${path}.sync_secret`, "invalid secp256k1 secret");
  } finally {
    syncSecretBytes.fill(0);
  }
  const head = stringValue(input.head_event_id, `${path}.head_event_id`, {
    max: 64,
  });
  if (head !== "" && !HEAD_PATTERN.test(head)) {
    fail(`${path}.head_event_id`, "expected empty or 64 lowercase hex chars");
  }
  return {
    schema: 0,
    mnemonic,
    sync_secret: syncSecret,
    mint_url: endpoint(input.mint_url, `${path}.mint_url`, "https:", options),
    relay_url: endpoint(
      input.relay_url,
      `${path}.relay_url`,
      "wss:",
      options,
      true
    ),
    head_event_id: head,
  };
}

export function decodeUnixSeconds(value: unknown, path: string): number {
  return safeInteger(value, path);
}

export { SyncValidationError };
