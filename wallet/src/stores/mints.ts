import { defineStore } from "pinia";
import { useLocalStorage } from "@vueuse/core";
import { useWorkersStore } from "./workers";
import { notifyError, notifySuccess } from "src/js/notify";
import {
  Mint,
  MintKeys,
  Proof,
  SerializedBlindedSignature,
  MintKeyset,
  GetInfoResponse,
} from "@cashu/cashu-ts";
import { useUiStore } from "./ui";
import { ref, watch } from "vue";
import { useProofsStore } from "./proofs";
import { i18n } from "src/boot/i18n";
import { useSettingsStore } from "./settings";
import { useNostrMintBackupStore } from "./nostrMintBackup";
import { bytesToHex } from "@noble/hashes/utils"; // already an installed dependency
import { PaymentMethod } from "src/stores/walletTypes";
import { sumProofAmounts } from "src/js/proofs";
import {
  V0_MINT_UNIT,
  type V0AuthorityProfile,
  assertV0AuthorityMint,
  assertV0Unit,
  rejectV0Operation,
} from "src/v0/profile";

export type StoredMint = {
  url: string;
  keys: MintKeys[];
  keysets: MintKeyset[];
  nickname?: string;
  info?: GetInfoResponse;
  errored?: boolean;
  motdDismissed?: boolean;
  multinutSelected?: boolean;
  lastInfoUpdated?: string;
  lastKeysetsUpdated?: string;
  // initialize api: new Mint(url) on activation
};

export class MintClass {
  mint: StoredMint;
  constructor(mint: StoredMint) {
    this.mint = mint;
  }
  get api() {
    return new Mint(this.mint.url);
  }
  get proofs() {
    const proofsStore = useProofsStore();
    return proofsStore.proofs.filter((p) =>
      this.mint.keysets.map((k) => k.id).includes(p.id)
    );
  }
  get allBalances() {
    // return an object with all balances for each unit
    const balances: Record<string, number> = {};
    this.units.forEach((unit) => {
      balances[unit] = this.unitBalance(unit);
    });
    return balances;
  }

  get keysets() {
    return this.mint.keysets.filter((k) => k.active);
  }

  get units() {
    return this.mint.keysets
      .map((k) => k.unit)
      .filter((value, index, self) => self.indexOf(value) === index);
  }

  unitKeysets(unit: string): MintKeyset[] {
    return this.mint.keysets.filter((k) => k.unit === unit);
  }

  unitProofs(unit: string): WalletProof[] {
    const proofsStore = useProofsStore();
    const unitKeysets = this.unitKeysets(unit);
    return proofsStore.proofs.filter(
      (p) => unitKeysets.map((k) => k.id).includes(p.id) && !p.reserved
    );
  }

  unitBalance(unit: string) {
    const proofs = this.unitProofs(unit);
    return sumProofAmounts(proofs);
  }
}

// App-local proof type with number amount (strategy b) and wallet metadata.
// Uses Omit to override Proof.amount (Amount) with number.
export type WalletProof = Omit<Proof, "amount"> & {
  amount: number;
  reserved: boolean;
  quote?: string;
};

export type Balances = {
  [unit: string]: number;
};

type BlindSignatureAudit = {
  signature: SerializedBlindedSignature;
  amount: number;
  secret: Uint8Array;
  id: string;
  r: string;
};

export const useMintsStore = defineStore("mints", {
  state: () => {
    const t = i18n.global.t;
    const activeProofs = ref<WalletProof[]>([]);
    const activeUnit = useLocalStorage<string>(
      "cashu.activeUnit",
      V0_MINT_UNIT
    );
    activeUnit.value = V0_MINT_UNIT;
    const activeMintUrl = useLocalStorage<string>("cashu.activeMintUrl", "");
    const authorityMintUrl = ref("");
    const addMintData = ref({
      url: "",
      nickname: "",
    });
    const mints = useLocalStorage("cashu.mints", [] as StoredMint[]);
    const showAddMintDialog = ref(false);
    const addMintBlocking = ref(false);
    const showRemoveMintDialog = ref(false);
    const showMintInfoDialog = ref(false);
    const showEditMintDialog = ref(false);

    const uiStoreGlobal: any = useUiStore();
    const settingsStoreGlobal: any = useSettingsStore();

    // Watch for changes in activeMintUrl and activeUnit
    watch([activeMintUrl, activeUnit], async () => {
      const proofsStore = useProofsStore();
      console.log(
        `watcher: activeMintUrl: ${activeMintUrl.value}, activeUnit: ${activeUnit.value}`
      );
      await proofsStore.updateActiveProofs();
    });

    return {
      t,
      activeProofs,
      activeUnit,
      activeMintUrl,
      authorityMintUrl,
      addMintData,
      mints,
      showAddMintDialog,
      addMintBlocking,
      showRemoveMintDialog,
      showMintInfoDialog,
      showEditMintDialog,
      uiStoreGlobal,
      settingsStoreGlobal,
    };
  },
  getters: {
    multiMints({ activeUnit }): StoredMint[] {
      return this.mints.filter((m) => {
        try {
          const version = m.info?.version;
          if (!version) return false;

          const regex = /^(Nutshell)\/(\d+)\.(\d+)\.(\d+)/; // Regex to match "Nutshell/version"
          const match = version.match(regex);
          if (!match || match[1] !== "Nutshell") return false;
          if (parseInt(match[2]) === 0 && parseInt(match[3]) < 17) return false; // If < 0.17.* then not viable

          const nut15 = m.info?.nuts[15];
          const viableMint = nut15?.methods.find(
            (m) => m.method === PaymentMethod.Bolt11 && m.unit === activeUnit
          );
          const balance = new MintClass(m).unitBalance(activeUnit);
          if (nut15 && viableMint && balance > 0) return true;
          else return false;
        } catch (e) {
          console.error(`${e}`);
          return false;
        }
      });
    },
    totalUnitBalance({ activeUnit }): number {
      const proofsStore = useProofsStore();
      const allUnitKeysets = this.mints
        .map((m) => m.keysets)
        .flat()
        .filter((k) => k.unit === activeUnit);
      const proofs = proofsStore.proofs
        .filter((p) => allUnitKeysets.map((k) => k.id).includes(p.id))
        .filter((p) => !p.reserved);
      const balance = sumProofAmounts(proofs);
      this.uiStoreGlobal.lastBalanceCached = balance;
      return balance;
    },
    activeBalance(): number {
      return sumProofAmounts(this.activeProofs.flat());
    },
    activeKeysets({ activeMintUrl, activeUnit }): MintKeyset[] {
      const unitKeysets = this.mints
        .find((m) => m.url === activeMintUrl)
        ?.keysets?.filter((k) => k.unit === activeUnit);
      if (!unitKeysets) {
        return [];
      }
      return unitKeysets;
    },
    activeKeys({ activeMintUrl, activeUnit }): MintKeys[] {
      const unitKeys = this.mints
        .find((m) => m.url === activeMintUrl)
        ?.keys?.filter((k) => k.unit === activeUnit);
      if (!unitKeys) {
        return [];
      }
      return unitKeys;
    },
    activeInfo({ activeMintUrl }): GetInfoResponse {
      return (
        this.mints.find((m) => m.url === activeMintUrl)?.info ||
        ({} as GetInfoResponse)
      );
    },
    activeUnitLabel({ activeUnit }): string {
      if (activeUnit == "sat") {
        if (this.settingsStoreGlobal.bip177BitcoinSymbol) {
          return "₿";
        } else {
          return "SAT";
        }
      } else if (activeUnit == "usd") {
        return "USD";
      } else if (activeUnit == "eur") {
        return "EUR";
      } else if (activeUnit == "msat") {
        return "mSAT";
      } else {
        return activeUnit;
      }
    },
    activeUnitCurrencyMultiplyer({ activeUnit }): number {
      if (activeUnit == "usd") {
        return 100;
      } else if (activeUnit == "eur") {
        return 100;
      } else {
        return 1;
      }
    },
    allMintKeysets(): MintKeyset[] {
      return this.mints.flatMap((m: StoredMint) => m.keysets ?? []);
    },
  },
  actions: {
    activeMint() {
      const mint = this.mints.find((m) => m.url === this.activeMintUrl);
      if (mint) {
        return new MintClass(mint);
      } else {
        throw new Error("No active mint");
      }
    },
    mintUnitProofs(mint: StoredMint, unit: string): WalletProof[] {
      const proofsStore = useProofsStore();
      const unitKeysets = mint.keysets.filter((k) => k.unit === unit);
      return proofsStore.proofs.filter(
        (p) => unitKeysets.map((k) => k.id).includes(p.id) && !p.reserved
      );
    },
    mintUnitKeysets(mint: StoredMint, unit: string): MintKeyset[] {
      return mint.keysets.filter((k) => k.unit === unit);
    },
    toggleUnit: function () {
      rejectV0Operation("unit-switch");
    },
    toggleActiveUnitForMint(mint: StoredMint) {
      const mintClass = new MintClass(mint);
      if (!mintClass.units.includes(V0_MINT_UNIT)) {
        throw new Error("The configured authority mint does not support USD");
      }
      this.activeUnit = V0_MINT_UNIT;
    },
    updateMint(oldMint: StoredMint, newMint: StoredMint) {
      const index = this.mints.findIndex((m) => m.url === oldMint.url);
      this.mints[index] = newMint;
    },
    updateMintMultinutSelection(mintUrl: string, selected: boolean) {
      rejectV0Operation("multi-mint");
    },
    getKeysForKeyset: async function (keyset_id: string): Promise<MintKeys> {
      const mint = this.mints.find((m) => m.url === this.activeMintUrl);
      if (mint) {
        const keys = mint.keys?.find((k) => k.id === keyset_id);
        if (keys) {
          return keys;
        } else {
          throw new Error("Keys not found");
        }
      } else {
        throw new Error("Mint not found");
      }
    },
    addMint: async function () {
      rejectV0Operation("mint-add");
    },
    bootstrapAuthorityMint: async function (
      profile: V0AuthorityProfile,
      verbose = false
    ): Promise<StoredMint> {
      const url = profile.mintUrl;
      assertV0AuthorityMint(profile, url);
      assertV0Unit(profile.unit);
      this.authorityMintUrl = url;
      this.addMintBlocking = true;
      try {
        const mintToAdd: StoredMint = {
          url: url,
          keys: [],
          keysets: [],
        };

        const existing = this.mints.find((mint) => mint.url === url);
        this.mints = [existing ?? mintToAdd];
        await this.activateAuthorityMint(
          profile,
          existing ?? mintToAdd,
          false,
          true
        );
        if (verbose) {
          await notifySuccess(this.t("wallet.mint.notifications.added"));
        }

        // Trigger Nostr backup if enabled
        this.triggerNostrBackup();

        return mintToAdd;
      } catch (error) {
        // activation failed, we remove the mint again from local storage
        this.mints = this.mints.filter((m) => m.url !== url);
        throw error;
      } finally {
        this.showAddMintDialog = false;
        this.addMintBlocking = false;
      }
    },
    activateMintUrl: async function (
      url: string,
      verbose = false,
      force = false,
      unit: string | undefined = undefined
    ) {
      rejectV0Operation("mint-switch");
    },
    selectMintUrl: function (
      url: string,
      unit: string | undefined = undefined
    ) {
      rejectV0Operation("mint-switch");
    },
    activateUnit: async function (unit: string, verbose = false) {
      assertV0Unit(unit);
      if (unit === this.activeUnit) {
        return;
      }
      rejectV0Operation("unit-switch");
    },
    updateMintInfoAndKeys: async function (mint: StoredMint) {
      const newMintInfo = await this.fetchMintInfo(mint);
      this.triggerMintInfoMotdChanged(newMintInfo, mint);
      mint = await this.fetchMintKeys(mint);

      const mintToUpdate = this.mints.filter((m) => m.url === mint.url)[0];
      mintToUpdate.errored = false;
      return mint;
    },
    activateMint: async function () {
      rejectV0Operation("mint-switch");
    },
    activateAuthorityMint: async function (
      profile: V0AuthorityProfile,
      mint: StoredMint,
      verbose = false,
      force = false
    ) {
      assertV0AuthorityMint(profile, mint.url);
      if (mint.url === this.activeMintUrl && !force) {
        return;
      }
      const workers = useWorkersStore();
      const uIStore = useUiStore();
      // we need to stop workers because they will reset the activeMint again
      workers.clearAllWorkers();

      // create new mint.api instance because we can't store it in local storage
      const previousUrl = this.activeMintUrl;
      await uIStore.lockMutex();
      try {
        mint = await this.updateMintInfoAndKeys(mint);
        this.toggleActiveUnitForMint(mint);
        if (verbose) {
          await notifySuccess(this.t("wallet.mint.notifications.activated"));
        }
        this.activeMintUrl = mint.url;
        console.log("### activateMint: Mint activated: ", this.activeMintUrl);
      } catch (error: any) {
        // restore previous values because the activation errored
        // this.activeMintUrl = previousUrl;
        let err_msg = this.t("wallet.mint.notifications.could_not_connect");
        if (error.message.length) {
          err_msg = err_msg + ` ${error.message}.`;
        }
        await notifyError(
          err_msg,
          this.t("wallet.mint.notifications.activation_failed")
        );
        this.mints.filter((m) => m.url === mint.url)[0].errored = true;
        throw error;
      } finally {
        await uIStore.unlockMutex();
      }
    },
    checkMintInfoMotdChanged(newMintInfo: GetInfoResponse, mint: StoredMint) {
      // if mint doesn't have info yet, we don't need to trigger the motd change
      if (!this.mints.find((m) => m.url === mint.url)?.info) {
        return false;
      }
      const motd = newMintInfo.motd;
      if (motd !== this.mints.filter((m) => m.url === mint.url)[0].info?.motd) {
        return true;
      }
      return false;
    },
    triggerMintInfoMotdChanged(
      newMintInfo: GetInfoResponse,
      mint: StoredMint,
      navigate = true
    ) {
      if (!this.checkMintInfoMotdChanged(newMintInfo, mint)) {
        return;
      }
      // set motd_viewed to false
      this.mints.filter((m) => m.url === mint.url)[0].motdDismissed = false;

      // Navigate to mint details page with mint URL as query parameter
      if (navigate) {
        window.location.href = `/mintdetails?mintUrl=${encodeURIComponent(
          mint.url
        )}`;
      }
    },
    fetchMintInfo: async function (mint: StoredMint) {
      try {
        const mintClass = new MintClass(mint);
        const data = await mintClass.api.getInfo();

        // if we have this mint in localstorage, update it
        const storedMint = this.mints.find((m) => m.url === mint.url);
        if (storedMint) {
          storedMint.info = data;
          storedMint.lastInfoUpdated = new Date().toISOString();
        }
        return data;
      } catch (error: any) {
        console.error(error);
        try {
          // notifyApiError(error, this.t("wallet.mint.notifications.could_not_get_info"));
        } catch {}
        throw error;
      }
    },
    checkForMintKeysetIdCollisions: async function (
      mintToAdd: StoredMint,
      keysets: MintKeyset[]
    ) {
      // check if there are any keysets with the same id in another mint
      const allKeysets = this.mints
        .filter((m) => m.url !== mintToAdd.url) // exclude the mint we are adding
        .map((m) => m.keysets)
        .flat();
      const collisions = keysets.filter((k) =>
        allKeysets.map((k) => k.id).includes(k.id)
      );
      // perform the same check for the integer representation of the keyset id
      function keysetIdToBigInt(id: string): bigint {
        if (/^[0-9a-fA-F]+$/.test(id)) {
          return BigInt(`0x${id}`) % BigInt(2 ** 31 - 1);
        } else {
          const bin = atob(id);
          const hex = bytesToHex(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
          return BigInt(`0x${hex}`) % BigInt(2 ** 31 - 1);
        }
      }
      const allKeysetsIdsBigInt = allKeysets.map((k) => keysetIdToBigInt(k.id));
      const hasCollisions = keysets.some((k) =>
        allKeysetsIdsBigInt.includes(keysetIdToBigInt(k.id))
      );
      if (hasCollisions) {
        const errorMessage = this.t(
          "wallet.mint.notifications.mint_validation_error"
        );
        throw new Error(errorMessage);
      }
      return true;
    },
    fetchMintKeys: async function (mint: StoredMint): Promise<StoredMint> {
      try {
        const mintClass = new MintClass(mint);
        const keysets = await this.fetchMintKeysets(mint);
        // if we do not have any keys yet, fetch them
        if (mint.keys.length === 0 || mint.keys.length == undefined) {
          const keys = await mintClass.api.getKeys();
          // store keys in mint and update local storage
          this.mints.filter((m) => m.url === mint.url)[0].keys = keys.keysets;
        }
        // reload mint from local storage
        mint = this.mints.filter((m) => m.url === mint.url)[0];

        // for each keyset we do not have keys for, fetch keys
        for (const keyset of keysets) {
          if (!mint.keys.find((k) => k.id === keyset.id)) {
            const keys = await mintClass.api.getKeys(keyset.id);
            // store keys in mint and update local storage
            this.mints
              .filter((m) => m.url === mint.url)[0]
              .keys.push(keys.keysets[0]);
          }
        }

        this.mints.filter((m) => m.url === mint.url)[0].lastKeysetsUpdated =
          new Date().toISOString();
        // return the mint with keys set
        return this.mints.filter((m) => m.url === mint.url)[0];
      } catch (error: any) {
        console.error(error);
        try {
          // notifyApiError(error, this.t("wallet.mint.notifications.could_not_get_keys"));
        } catch {}
        throw error;
      }
    },
    fetchMintKeysets: async function (mint: StoredMint) {
      // fetches and stores keysets for a mint
      try {
        const mintClass = new MintClass(mint);
        const data = await mintClass.api.getKeySets();
        const keysets = data.keysets;
        if (keysets.length > 0) {
          // check for keyset id collisions with other mints
          await this.checkForMintKeysetIdCollisions(mint, keysets);
          // store keysets in mint and update local storage
          // merge new keysets with existing ones instead of overwriting
          const storedMint = this.mints.find((m) => m.url === mint.url);
          if (storedMint) {
            const existingKeysets = storedMint.keysets || [];
            const mergedKeysets = [...existingKeysets];

            // Add or update keysets
            for (const newKeyset of keysets) {
              const existingIndex = mergedKeysets.findIndex(
                (k) => k.id === newKeyset.id
              );
              if (existingIndex !== -1) {
                // Update existing keyset
                mergedKeysets[existingIndex] = newKeyset;
              } else {
                // Add new keyset
                mergedKeysets.push(newKeyset);
              }
            }

            storedMint.keysets = mergedKeysets;
          }
        }
        return keysets;
      } catch (error: any) {
        console.error(error);
        throw error;
      }
    },
    removeMint: async function (url: string) {
      rejectV0Operation("mint-remove");
    },
    assertMintError: function (
      response: Record<string, unknown>,
      verbose = true
    ) {
      if (response.error != null) {
        if (verbose) {
          notifyError(
            String(response.error),
            this.t("wallet.mint.notifications.error")
          );
        }
        throw new Error(`Mint error: ${response.error}`);
      }
    },

    // Trigger Nostr backup when mints change
    triggerNostrBackup: async function () {
      try {
        const nostrMintBackupStore = useNostrMintBackupStore();

        if (nostrMintBackupStore.enabled && nostrMintBackupStore.needsBackup) {
          setTimeout(async () => {
            try {
              await nostrMintBackupStore.backupMintsToNostr();
            } catch (error) {
              console.error("Failed to backup mints to Nostr:", error);
            }
          }, 1000);
        }
      } catch (error) {
        console.error("Failed to trigger Nostr backup:", error);
      }
    },
  },
});
