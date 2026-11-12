export const title = "What two devices can do with the same pending payment";
const states = {
  "idle": "Wallet ready",
  "prepared": "Payment prepared",
  "accepted": "First wallet can send payment",
  "ambiguous": "Waiting to confirm relay save",
  "aborted": "Stopped before sending",
  "both-ready": "Second wallet also allowed to send",
  "one-post": "One request sent to mint",
  "two-posts": "Both wallets sent the same request",
  "recovering": "Recovering the payment",
  "recorded": "Mint result saved",
  "pending": "Mint reports payment pending",
  "final-accepted": "Relay saved the result",
  "done": "Result recorded on device"
};
const steps = {
  "Prepare": "Prepare payment",
  "PublishA": "Save payment intent to relay",
  "ConfirmA": "Confirm previous save",
  "RejectBeforeSubmit": "Intent rejected or superseded",
  "ImportPeerPrepared": "Second wallet loads the saved payment",
  "MarkA": "First wallet records that it will send",
  "MarkB": "Second wallet records that it will send",
  "PublishB": "Other wallet resumes and saves the same intent",
  "PostA": "Send payment request",
  "PostB": "Send payment request",
  "LoseResponse": "Payment result unknown after interruption",
  "RecordResponse": "Record mint result",
  "KeepPending": "Wait for settlement",
  "FinalCAS": "Save final result to relay",
  "ApplyFinal": "Update device from saved result"
};
export const state = (v) => states[v.sent.length > 1 ? "two-posts" : ["inflight","accepted","marked","ambiguous","prepared","idle"].includes(v.a) && v.sent.length === 1 ? "one-post" : ["accepted","marked"].includes(v.b) ? "both-ready" : v.a === "marked" ? "accepted" : v.a];
export const step = (action) => steps[action] ?? null;
