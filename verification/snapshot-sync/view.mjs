export const title = "Reconnect a wallet after missing updates";
const states = {
  "local": "Local wallet opens",
  "reading": "Looking for changes from other devices",
  "synchronized": "Wallet synchronized",
  "checking-mint": "Old relay history gone, checking tokens",
  "preserved": "Local wallet preserved",
  "corrected": "Mint confirms spendable tokens",
  "publishing": "Saving reconciled wallet",
  "retained-locally": "Correction retained on this device"
};
const steps = {
  "ReadHead": "Open, reconnect or switch back to wallet",
  "NoChange": "No newer wallet state",
  "ApplyVerified": "Apply verified wallet state",
  "ReadMint": "Relay no longer retains the full history",
  "PreserveOnFailure": "Cannot safely verify newer state",
  "Reconcile": "Keep usable tokens and quarantine pending ones",
  "PublishCorrection": "Send correction to relay",
  "AcceptCorrection": "Relay confirms correction",
  "KeepCorrection": "Relay could not confirm correction",
  "Retry": "Retry synchronization"
};
export const state = (v) => states[v.phase];
export const step = (action) => steps[action] ?? null;
