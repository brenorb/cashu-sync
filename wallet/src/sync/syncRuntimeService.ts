import { generateSecretKey } from "nostr-tools";
import { cashuDb } from "src/stores/dexie";
import { useMintsStore } from "src/stores/mints";
import {
  LocalAuthorityRepository,
  type AuthorityStorage,
} from "src/sync/authorityRepository";
import type { AuthorityPayloadV0 } from "src/sync/authorityPayload";
import { bytesToHex } from "src/sync/syncCrypto";
import {
  createBrowserWalletSyncRuntime,
  type WalletSyncStartOutcome,
} from "src/sync/walletSyncRuntime";
import { createV0AuthorityProfile } from "src/v0/profile";

export type SyncRuntimeBootOutcome = {
  authority: AuthorityPayloadV0 | null;
  sync: WalletSyncStartOutcome;
};

export class SyncRuntimeService {
  readonly allowLoopbackHttp: boolean;
  readonly authority: LocalAuthorityRepository;
  readonly runtime;

  constructor(
    options: {
      storage?: AuthorityStorage;
      mintUrl?: string;
      relayUrl?: string;
      allowLoopbackHttp?: boolean;
    } = {}
  ) {
    this.allowLoopbackHttp = options.allowLoopbackHttp ?? false;
    this.configuredMintUrl = options.mintUrl ?? "";
    this.configuredRelayUrl = options.relayUrl ?? "";
    const storage = options.storage ?? localStorage;
    this.authority = new LocalAuthorityRepository(cashuDb, storage, {
      allowLoopbackHttp: this.allowLoopbackHttp,
    });
    this.runtime = createBrowserWalletSyncRuntime({
      db: cashuDb,
      storage,
      validation: { allowLoopbackHttp: this.allowLoopbackHttp },
    });
  }

  private readonly configuredMintUrl: string;
  private readonly configuredRelayUrl: string;

  async boot(mnemonic: string): Promise<SyncRuntimeBootOutcome> {
    let authority = this.authority.loadAndRepairMnemonic();
    if (authority === null && this.hasBuildAuthority()) {
      authority = this.createNewAuthority(mnemonic);
    }
    if (authority === null) {
      return { authority: null, sync: { status: "unconfigured" } };
    }
    await this.bootstrapMint(authority);
    return { authority, sync: await this.runtime.start() };
  }

  async importAndStart(value: unknown): Promise<SyncRuntimeBootOutcome> {
    const authority = await this.runtime.importForRecovery(value);
    await this.bootstrapMint(authority);
    return { authority, sync: await this.runtime.start() };
  }

  exportAuthority(): Promise<AuthorityPayloadV0> {
    return this.authority.exportCurrent();
  }

  private hasBuildAuthority(): boolean {
    return this.configuredMintUrl !== "" && this.configuredRelayUrl !== "";
  }

  private createNewAuthority(mnemonic: string): AuthorityPayloadV0 {
    const secret = generateSecretKey();
    try {
      return this.authority.importAuthority({
        schema: 0,
        mnemonic,
        sync_secret: bytesToHex(secret),
        mint_url: this.configuredMintUrl,
        relay_url: this.configuredRelayUrl,
        head_event_id: "",
      });
    } finally {
      secret.fill(0);
    }
  }

  private async bootstrapMint(authority: AuthorityPayloadV0): Promise<void> {
    const profile = createV0AuthorityProfile(authority.mint_url, {
      allowInsecureLoopback: this.allowLoopbackHttp,
    });
    await useMintsStore().bootstrapAuthorityMint(profile);
  }
}

let browserService: SyncRuntimeService | null = null;

export function useSyncRuntimeService(): SyncRuntimeService {
  if (browserService === null) {
    browserService = new SyncRuntimeService({
      mintUrl: process.env.CASHU_SYNC_MINT_URL,
      relayUrl: process.env.CASHU_SYNC_RELAY_URL,
      allowLoopbackHttp:
        process.env.CASHU_SYNC_ALLOW_INSECURE_LOOPBACK === true ||
        process.env.CASHU_SYNC_ALLOW_INSECURE_LOOPBACK === "true",
    });
  }
  return browserService;
}

export function resetSyncRuntimeServiceForTests(): void {
  browserService = null;
}
