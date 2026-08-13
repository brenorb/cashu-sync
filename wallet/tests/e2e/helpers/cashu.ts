export type ExternalMintQuote = {
  quote: string;
  request: string;
  amount: number;
  unit: "usd";
  state: string;
};

function mintUrl(): string {
  return (
    process.env.CASHU_SYNC_NUTSHELL_URL ||
    process.env.CASHU_SYNC_MINT_URL ||
    "http://127.0.0.1:3338"
  ).replace(/\/$/, "");
}

function parseQuote(value: unknown): ExternalMintQuote {
  if (!value || typeof value !== "object") {
    throw new Error("Nutshell returned a non-object Bolt11 quote");
  }
  const quote = value as Record<string, unknown>;
  if (
    typeof quote.quote !== "string" ||
    quote.quote === "" ||
    typeof quote.request !== "string" ||
    !/^ln(?:bc|tb|bcrt)/i.test(quote.request) ||
    typeof quote.amount !== "number" ||
    !Number.isSafeInteger(quote.amount) ||
    quote.amount <= 0 ||
    quote.unit !== "usd" ||
    typeof quote.state !== "string"
  ) {
    throw new Error(
      `Nutshell returned an invalid Bolt11/USD quote: ${JSON.stringify(value)}`
    );
  }
  return quote as ExternalMintQuote;
}

export async function createPayableUsdBolt11Invoice(
  amount: number
): Promise<ExternalMintQuote> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(
      "external invoice amount must be a positive whole USD unit"
    );
  }
  const response = await fetch(`${mintUrl()}/v1/mint/quote/bolt11`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount, unit: "usd" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Nutshell external invoice returned HTTP ${
        response.status
      }: ${await response.text()}`
    );
  }
  return parseQuote(await response.json());
}

export async function waitForMintQuoteState(
  quoteId: string,
  expectedState: string,
  timeoutMs = 15_000
): Promise<ExternalMintQuote> {
  const deadline = Date.now() + timeoutMs;
  let latest: ExternalMintQuote | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${mintUrl()}/v1/mint/quote/bolt11/${encodeURIComponent(quoteId)}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!response.ok) {
      throw new Error(
        `Nutshell quote lookup returned HTTP ${
          response.status
        }: ${await response.text()}`
      );
    }
    latest = parseQuote(await response.json());
    if (latest.state === expectedState) return latest;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Nutshell quote ${quoteId} remained ${
      latest?.state || "unknown"
    }; expected ${expectedState}`
  );
}
