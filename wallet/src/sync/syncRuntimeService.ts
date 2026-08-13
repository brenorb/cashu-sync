import { generateSecretKey } from "nostr-tools";
import {
  cashuDb,
  resetCashuDexie,
  WALLET_SYNC_STATE_ID,
  useDexieStore,
} from "src/stores/dexie";
import { useMintsStore } from "src/stores/mints";
import { useMigrationsStore } from "src/stores/migrations";
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
  private readonly storage: AuthorityStorage;
  private lifecycleQueue: Promise<void> = Promise.resolve();

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
    this.storage = storage;
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

  boot(mnemonic: string): Promise<SyncRuntimeBootOutcome> {
    return this.runExclusive(() => this.bootUnlocked(mnemonic));
  }

  private async bootUnlocked(
    mnemonic: string
  ): Promise<SyncRuntimeBootOutcome> {
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

  importAndStart(value: unknown): Promise<SyncRuntimeBootOutcome> {
    return this.runExclusive(() => this.importAndStartUnlocked(value));
  }

  private async importAndStartUnlocked(
    value: unknown
  ): Promise<SyncRuntimeBootOutcome> {
    const authority = await this.runtime.importForRecovery(value);
    await this.bootstrapMint(authority);
    return { authority, sync: await this.runtime.start() };
  }

  /**
   * Pairing/recovery may replace only an empty local wallet. This also handles
   * a fresh installation that already published its own empty genesis.
   */
  replaceEmptyAndStart(value: unknown): Promise<SyncRuntimeBootOutcome> {
    return this.runExclusive(() => this.replaceEmptyAndStartUnlocked(value));
  }

  private async replaceEmptyAndStartUnlocked(
    value: unknown
  ): Promise<SyncRuntimeBootOutcome> {
    const candidate = this.authority.validate(value);
    await this.prepareLegacyState();
    const [proofs, quotes, history, ecashHistory, state] = await Promise.all([
      cashuDb.proofs.count(),
      Promise.all([cashuDb.mintQuotes.count(), cashuDb.meltQuotes.count()]),
      cashuDb.paymentHistory.count(),
      cashuDb.ecashHistory.count(),
      cashuDb.walletSyncState.get(WALLET_SYNC_STATE_ID),
    ]);
    const hasLocalWalletData =
      proofs > 0 ||
      quotes.some((count) => count > 0) ||
      history > 0 ||
      ecashHistory > 0 ||
      (state?.pending_operation ?? null) !== null ||
      Object.keys(state?.counters ?? {}).length > 0;
    if (hasLocalWalletData) {
      throw new Error("pairing or recovery requires an empty local wallet");
    }
    const previousAuthority = this.authority.load();
    const mintStore = useMintsStore();
    const previousMintState = {
      mints: cloneStoredValue(mintStore.mints),
      activeMintUrl: mintStore.activeMintUrl,
      activeUnit: mintStore.activeUnit,
      authorityMintUrl: mintStore.authorityMintUrl,
      activeProofs: cloneStoredValue(mintStore.activeProofs),
    };
    // Prove the authority mint is reachable and compatible before changing
    // either local authority or IndexedDB state.
    try {
      await this.bootstrapMint(candidate);
    } catch (error) {
      mintStore.$patch(previousMintState);
      throw error;
    }
    const previousState = state;
    await resetCashuDexie(cashuDb);
    this.authority.clear();
    await this.runtime.resetSession();
    try {
      return await this.importAndStartUnlocked(candidate);
    } catch (error) {
      await resetCashuDexie(cashuDb);
      if (previousState) await cashuDb.walletSyncState.put(previousState);
      if (previousAuthority) this.authority.importAuthority(previousAuthority);
      else this.authority.clear();
      mintStore.$patch(previousMintState);
      await this.runtime.resetSession();
      throw error;
    }
  }

  exportAuthority(): Promise<AuthorityPayloadV0> {
    return this.authority.exportCurrent();
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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

  private async prepareLegacyState(): Promise<void> {
    const migrations = useMigrationsStore();
    migrations.initMigrations();
    await migrations.runMigrations();
    await useDexieStore().migrateToDexie();
    for (const key of [
      "cashu.proofs",
      "cashu.invoiceHistory",
      "cashu.keysetCounters",
    ]) {
      const value = this.storage.getItem(key);
      if (value && value !== "[]" && value !== "{}") {
        throw new Error(`legacy wallet state remains in ${key}`);
      }
    }
  }
}

function cloneStoredValue<T>(value: T): T {
  // These Pinia fields are already persisted as JSON. Serializing them also
  // unwraps nested Vue proxies that the browser structured-clone algorithm
  // correctly refuses to copy.
  return JSON.parse(JSON.stringify(value)) as T;
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
