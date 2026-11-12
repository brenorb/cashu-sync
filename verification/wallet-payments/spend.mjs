export const title = "Spend credits or top up an eSIM";
const states = {
  "wallet": "Wallet",
  "amount": "Enter amount or paste invoice",
  "requesting": "Requesting spend quote",
  "stored": "Saving spend quote",
  "quote-recovery": "Check sync before paying",
  "quote": "Review amount and fee",
  "settling": "Paying",
  "recovery": "Recovering your spend",
  "paid-final": "Payment confirmed",
  "unpaid-final": "Unpaid, journal cleared",
  "paid-success": "Credits spent and synchronized",
  "unpaid-success": "Credits spent shown for unpaid invoice"
};
const steps = {
  "EnterAmount": "Tap Top up or Pay invoice",
  "RequestQuote": "Get spend quote",
  "QuoteError": "Invalid amount, invoice or quote unavailable",
  "RejectQuote": "Wallet changed elsewhere",
  "StoreQuote": "Quote received",
  "AmbiguousQuote": "Relay did not confirm the quote",
  "ShowQuote": "Quote ready",
  "Confirm": "Confirm spend",
  "WaitForRecovery": "Payment status still unknown",
  "FinishOtherQuote": "Another payment settled first",
  "RecordPaid": "Mint confirms payment",
  "RecordUnpaid": "Mint says unpaid and inputs are released",
  "DisplaySuccess": "Wallet closes the spend dialog"
};
export const state = (v) => states[["final","success"].includes(v.phase) ? v.payment + "-" + v.phase : v.phase];
export const step = (action) => steps[action] ?? null;
