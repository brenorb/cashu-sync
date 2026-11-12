export const title = "Pair a second device";
const states = {
  "idle": "Sync devices",
  "qr": "Pairing QR ready",
  "waiting": "Joining wallet waits for a response",
  "importing": "Joining wallet checks the authority",
  "paired": "Joining wallet imported",
  "preserved": "Existing wallet preserved",
  "cancelled": "Pairing cancelled on joining wallet",
  "failed": "Pairing needs attention",
  "closed": "Host closed the pairing screen",
  "valid": "Both wallets paired",
  "ack": "Host reports success after import refused",
  "head": "Host reports success after unrelated activity"
};
const steps = {
  "CreateQR": "Show pairing QR",
  "OpenQR": "Scan or open the pairing link",
  "BadQR": "Link is invalid or expired",
  "ServeAuthority": "Host sends encrypted wallet authority",
  "Import": "Joining wallet starts with that authority",
  "RefuseReplacement": "Different wallet contains local data",
  "CancelReplacement": "Keep current wallet",
  "Ack": "Host receives acknowledgement",
  "HeadAdvance": "Relay head changes",
  "Timeout": "No response before deadline",
  "CloseHost": "Leave pairing screen"
};
export const state = (v) => states[v.host === "success" ? (v.imported ? "valid" : v.cause) : v.host === "closed" ? "closed" : v.join === "idle" ? v.host : v.join];
export const step = (action, from) => {
  // Show leaving the host screen at the QR and error checkpoints.
  if (action === "CloseHost" && !["idle", "failed"].includes(from.join)) return null;
  // The first QR checkpoint already illustrates the unrelated-head path.
  if (action === "HeadAdvance" && !["idle", "paired"].includes(from.join)) return null;
  return steps[action] ?? null;
};
