export const title = "How paired wallets coordinate a payment";
export const state = (v) => {
  const phases = Object.values(v.phase);
  if (v.relay === "final") {
    return phases.includes("done") ? "Payment result recorded on device" : "Relay saved the result";
  }
  if (phases.includes("recorded")) return "Mint result saved locally";
  if (phases.includes("pending")) return "Mint reports payment pending";
  if (phases.includes("recovering")) return "A wallet is recovering the payment";
  if (phases.includes("inflight")) return "Payment request sent";
  if (phases.includes("can-send")) return "Winning wallet saved its submission locally";
  if (phases.includes("direct")) return "Relay accepted the submission";
  if (phases.includes("lost")) return "Waiting to confirm the relay save";
  if (phases.includes("prepared")) return "Payment prepared";
  if (phases.includes("aborted")) return "Stopped before sending";
  return "Wallet ready";
};
const steps = {
  Prepare: "Prepare payment",
  LoseCAS: "Another wallet won the relay write",
  Reject: "Relay rejected the submission",
  AcceptDirect: "Save the accepted submission on the winning device",
  ResumeFence: "Read the saved submission and check the mint",
  Interrupt: "Continue from the journal after an interruption",
  FirstPost: "Send the prepared payment",
  ObserveResult: "Record the mint result",
  FinalCAS: "Save the result to the relay",
  ApplyFinal: "Read the saved result",
};
export const step = (action, from, to) =>
  action === "Fence" ? (Object.values(to.phase).includes("lost")
    ? "Relay acknowledgement lost" : "One wallet wins the relay write")
    : steps[action] ?? null;
