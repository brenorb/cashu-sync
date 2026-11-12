export const title = "Open the wallet and recover a payment";
const states = {
  "starting": "Starting synchronized wallet",
  "unconfigured": "Pair or restore this wallet",
  "ready": "Wallet ready",
  "reconnecting": "Reconnecting wallet",
  "recovering": "Recovering previous payment",
  "error": "Startup needs attention",
  "false-ready": "Wallet says synchronized while payment is pending"
};
const steps = {
  "NotConfigured": "No wallet profile",
  "BootReady": "Wallet state is ready",
  "BootPending": "Find an unfinished payment",
  "BootError": "Wallet startup failed",
  "WatchDisconnected": "Relay connection drops",
  "WatchConnected": "Relay socket connects",
  "ResumeSettled": "Previous payment resolved",
  "ReloadUpdatedPage": "App update reloads the page"
};
export const state = (v) => states[v.s.badge === "synchronized" && v.s.pending ? "false-ready" : ["reconnecting","error"].includes(v.s.badge) ? v.s.badge : v.s.phase];
export const step = (action) => steps[action] ?? null;
