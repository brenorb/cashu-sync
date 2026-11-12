export const title = "Back up, restore or remove this wallet";
const states = {
  "wallet": "Recovery settings",
  "downloaded": "Encrypted backup downloaded",
  "decrypt": "Reading backup",
  "rejected": "Wallet preserved, action needs attention",
  "checking-mint": "Checking the configured mint",
  "reset": "Preparing empty local wallet",
  "starting": "Fetching wallet state",
  "ready": "Wallet restored",
  "recovering": "Resuming the previous payment",
  "remove": "Checking wallet before removal",
  "backed-up": "Relay backup confirmed",
  "removed": "Wallet removed from this device"
};
const steps = {
  "Download": "Download with matching passphrases",
  "OpenBackup": "Choose backup and enter passphrase",
  "BadPassphrase": "Cannot decrypt backup",
  "SameAuthority": "Backup belongs to this wallet",
  "DifferentFunded": "Device already has a different wallet",
  "DifferentEmpty": "Device is empty",
  "MintUnavailable": "Mint unavailable or incompatible",
  "ResetEmptyWallet": "Mint passed the check",
  "ImportAuthority": "Open wallet from backup",
  "HeadFound": "Relay snapshot loaded",
  "FreshGenesis": "Start wallet with no remembered backup",
  "FailAndRollBack": "Relay restore failed, retry possible",
  "ResumeJournal": "Local payment still needs recovery",
  "RequestRemoval": "Confirm removal from device",
  "RetainWallet": "Payment pending or backup unconfirmed",
  "ConfirmRelayBackup": "Relay confirms saved wallet",
  "EraseDevice": "Clear device data"
};
export const state = (v) => states[v.phase];
export const step = (action) => steps[action] ?? null;
