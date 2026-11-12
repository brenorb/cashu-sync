export const title = "Buy credits";
const states = {
  "wallet": "Wallet",
  "amount": "Enter amount",
  "requesting": "Requesting invoice",
  "stored": "Saving invoice",
  "quote-recovery": "Check sync before paying",
  "quote": "Lightning invoice",
  "claimable": "Invoice paid, ready to claim",
  "settling": "Claiming credits",
  "recovery": "Recovering your purchase",
  "final": "Credits recorded",
  "success": "Credits bought and synchronized"
};
const steps = {
  "EnterAmount": "Tap Buy credits",
  "RequestQuote": "Request invoice",
  "QuoteError": "Could not request invoice",
  "RejectQuote": "Wallet changed elsewhere",
  "StoreQuote": "Invoice received",
  "AmbiguousQuote": "Relay did not confirm the invoice",
  "ShowQuote": "Invoice ready",
  "InvoicePaid": "Pay the Lightning invoice",
  "Confirm": "Claim credits or automatic claim",
  "WaitForRecovery": "Payment status still unknown",
  "FinishOtherQuote": "Another payment settled first",
  "RecordPaid": "Mint confirms credit",
  "DisplaySuccess": "Balance and history updated"
};
export const state = (v) => states[v.phase];
export const step = (action) => steps[action] ?? null;
