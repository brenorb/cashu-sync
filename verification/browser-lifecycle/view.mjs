export const title = "Open the wallet and recover a payment";
const states = {
  "starting": "Starting synchronized wallet",
  "unconfigured": "Pair or restore this wallet",
  "ready": "Wallet ready",
  "reconnecting": "Reconnecting wallet",
  "recovering": "Recovering previous payment",
  "checking": "Checking wallet sync",
  "error": "Startup needs attention"
};
const steps = {
  "NotConfigured": "No wallet profile",
  "BootReady": "Wallet state is ready",
  "BootPending": "Find an unfinished payment",
  "BootError": "Wallet startup failed",
  "WatchDisconnected": "Relay connection drops",
  "WatchConnected": "Relay socket connects",
  "CheckStillPending": "Wallet finds an unresolved payment",
  "CheckSettled": "Wallet confirms the journal is clear",
  "ResumeSettled": "Previous payment resolved",
  "ReloadUpdatedPage": "App update reloads the page"
};
export const state = (v) => states[["reconnecting","checking","error"].includes(v.s.badge) ? v.s.badge : v.s.phase];
export const step = (action) => steps[action] ?? null;
