export const title = "Pair a second device";
const states = {
  idle: "Sync devices",
  qr: "Pairing QR ready",
  waiting: "Joining wallet waits for a response",
  importing: "Joining wallet checks the authority",
  imported: "Joining wallet imported",
  "ack-sent": "Joining wallet sent confirmation",
  unconfirmed: "Wallet imported, host confirmation uncertain",
  preserved: "Existing wallet preserved",
  cancelled: "Pairing cancelled on joining wallet",
  failed: "Pairing needs attention",
  closed: "Host closed the pairing screen",
  success: "Both wallets paired",
};
const steps = {
  CreateQR: "Show pairing QR",
  OpenQR: "Scan or open the pairing link",
  BadQR: "Link is invalid or expired",
  ServeAuthority: "Host sends encrypted wallet authority",
  Import: "Joining wallet starts with that authority",
  ImportError: "Joining wallet cannot start",
  RefuseReplacement: "Different wallet contains local data",
  CancelReplacement: "Keep current wallet",
  PublishAck: "Joining wallet confirms the import",
  AckFailure: "Relay could not confirm receipt",
  Ack: "Host receives acknowledgement",
  Timeout: "No response before deadline",
  CloseHost: "Leave pairing screen",
};
export const state = (v) => states[
  ["success", "closed"].includes(v.host) || v.join === "idle" ? v.host : v.join
];
export const step = (action, from) => {
  if (action === "CloseHost" && !["idle", "failed"].includes(from.join)) return null;
  return steps[action] ?? null;
};
