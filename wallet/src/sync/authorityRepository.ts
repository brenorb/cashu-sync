import type { CashuDexie } from "src/stores/dexie";
import {
  decodeAuthorityPayloadV0,
  type AuthorityPayloadV0,
  type AuthorityValidationOptions,
} from "src/sync/authorityPayload";

export const AUTHORITY_STORAGE_KEY_V0 = "cashu-sync.authority.v0";
const LEGACY_MNEMONIC_KEY = "cashu.mnemonic";

export interface AuthorityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Keeps the v0 authority in one synchronous record. The legacy mnemonic key is
 * only a compatibility mirror for the imported Cashu.me store; this record is
 * written first and repairs that mirror on every boot.
 */
export class LocalAuthorityRepository {
  constructor(
    private readonly db: CashuDexie,
    private readonly storage: AuthorityStorage = localStorage,
    private readonly validation: AuthorityValidationOptions = {}
  ) {}

  load(): AuthorityPayloadV0 | null {
    const raw = this.storage.getItem(AUTHORITY_STORAGE_KEY_V0);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error("stored authority contains invalid JSON", { cause });
    }
    return decodeAuthorityPayloadV0(parsed, this.validation);
  }

  loadAndRepairMnemonic(): AuthorityPayloadV0 | null {
    const authority = this.load();
    if (authority === null) return null;
    if (this.storage.getItem(LEGACY_MNEMONIC_KEY) !== authority.mnemonic) {
      this.storage.setItem(LEGACY_MNEMONIC_KEY, authority.mnemonic);
    }
    return authority;
  }

  importAuthority(value: unknown): AuthorityPayloadV0 {
    const authority = decodeAuthorityPayloadV0(value, this.validation);
    // This order makes an interrupted mirror write recoverable at next boot.
    this.storage.setItem(AUTHORITY_STORAGE_KEY_V0, JSON.stringify(authority));
    this.storage.setItem(LEGACY_MNEMONIC_KEY, authority.mnemonic);
    return authority;
  }

  async exportCurrent(): Promise<AuthorityPayloadV0> {
    const authority = this.load();
    if (authority === null) throw new Error("wallet authority is not configured");
    const state = await this.db.walletSyncState.get("wallet");
    return decodeAuthorityPayloadV0(
      {
        ...authority,
        head_event_id: state?.head_event_id ?? "",
      },
      this.validation
    );
  }

  clear(): void {
    this.storage.removeItem(AUTHORITY_STORAGE_KEY_V0);
    this.storage.removeItem(LEGACY_MNEMONIC_KEY);
  }
}
