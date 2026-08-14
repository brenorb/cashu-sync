import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSilentLinkTopupQuote } from "../topupService";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requestSilentLinkTopupQuote", () => {
  it("requests a quote without exposing invoice details to the caller", async () => {
    vi.stubEnv("CASHU_SYNC_TOPUP_URL", "https://silent.link/api/topup/quote");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            topup_id: "topup-1",
            invoice: `lnbc${"a".repeat(24)}`,
            amount: 100,
          }),
          { status: 200 }
        )
      )
    );

    await expect(requestSilentLinkTopupQuote(100)).resolves.toMatchObject({
      topup_id: "topup-1",
      amount: 100,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://silent.link/api/topup/quote",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ amount: 100, currency: "USD" }),
      })
    );
  });

  it("fails closed when the provider is not configured", async () => {
    await expect(requestSilentLinkTopupQuote(100)).rejects.toThrow(
      "credit spending is not configured"
    );
  });
});
