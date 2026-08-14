export type SilentLinkTopupQuote = {
  topup_id: string;
  invoice: string;
  amount: number;
};

const INVOICE_PATTERN = /^(?:lnbc|lntb|lnbcrt)[a-z0-9]{20,}$/i;

export async function requestSilentLinkTopupQuote(
  amount: number
): Promise<SilentLinkTopupQuote> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("amount must be greater than zero");
  }
  const endpoint = process.env.CASHU_SYNC_TOPUP_URL?.trim();
  if (!endpoint) {
    throw new Error("Silent Link credit spending is not configured");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, currency: "USD" }),
    });
  } catch {
    throw new Error("Silent Link credit service is unavailable");
  }
  if (!response.ok)
    throw new Error("Silent Link credit service rejected the request");
  const value = (await response.json()) as Partial<SilentLinkTopupQuote>;
  if (
    typeof value.topup_id !== "string" ||
    !INVOICE_PATTERN.test(value.invoice ?? "") ||
    value.amount !== amount
  ) {
    throw new Error("Silent Link credit service returned an invalid quote");
  }
  return value as SilentLinkTopupQuote;
}
