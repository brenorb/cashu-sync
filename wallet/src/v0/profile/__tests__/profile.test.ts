import { describe, expect, it } from "vitest";
import {
  V0_MINT_UNIT,
  V0_PAYMENT_METHOD,
  V0ProfileError,
  assertV0AuthorityMint,
  assertV0NoMultiPartPayment,
  assertV0Unit,
  createV0AuthorityProfile,
  parseV0Bolt11Request,
  rejectV0Operation,
} from "../index";

describe("v0 product profile", () => {
  it("fixes the monetary lane to USD over Bolt11", () => {
    expect(V0_MINT_UNIT).toBe("usd");
    expect(V0_PAYMENT_METHOD).toBe("bolt11");
    expect(() => assertV0Unit("usd")).not.toThrow();
    expect(() => assertV0Unit("sat")).toThrowError(V0ProfileError);
  });

  it.each([
    ["lnbc1invoice", "lnbc1invoice"],
    ["LNTB1INVOICE", "LNTB1INVOICE"],
    ["  lightning:lnbcrt1invoice  ", "lnbcrt1invoice"],
    ["LIGHTNING:LNTBS1INVOICE", "LNTBS1INVOICE"],
  ])("accepts only direct Bolt11 requests: %s", (request, expected) => {
    expect(parseV0Bolt11Request(request)).toBe(expected);
  });

  it.each([
    "",
    "lightning:",
    "lightning:lno1offer",
    "lightning:lnurl1pay",
    "lnurl1pay",
    "alice@example.com",
    "bitcoin:bc1qexample?lightning=lnbc1invoice",
    "cashuAeyJ0b2tlbiI6W119fQ",
    "https://mint.example",
    "creqa1request",
  ])("rejects alternate payment/request ingress: %s", (request) => {
    expect(() => parseV0Bolt11Request(request)).toThrowError(V0ProfileError);
  });

  it("binds bootstrap to one normalized authority mint", () => {
    const profile = createV0AuthorityProfile("https://mint.example/");

    expect(profile).toEqual({
      mintUrl: "https://mint.example",
      unit: "usd",
      paymentMethod: "bolt11",
    });
    expect(() =>
      assertV0AuthorityMint(profile, "https://mint.example/")
    ).not.toThrow();
    expect(() =>
      assertV0AuthorityMint(profile, "https://other.example")
    ).toThrowError(V0ProfileError);
    expect(() =>
      assertV0AuthorityMint(
        {
          mintUrl: "https://mint.example",
          unit: "usd",
          paymentMethod: "bolt11",
        } as never,
        "https://mint.example"
      )
    ).toThrowError("requires a validated v0 profile");
  });

  it.each([
    "http://mint.example",
    "ftp://mint.example",
    "https://user:secret@mint.example",
    "https://mint.example/path",
    "https://mint.example?query=yes",
    "https://mint.example#fragment",
  ])("rejects a non-origin authority mint URL: %s", (mintUrl) => {
    expect(() => createV0AuthorityProfile(mintUrl)).toThrowError(
      expect.objectContaining({ code: "V0_INVALID_AUTHORITY_MINT" })
    );
  });

  it("permits loopback HTTP only with explicit E2E opt-in", () => {
    expect(() => createV0AuthorityProfile("http://127.0.0.1:3338")).toThrow();
    expect(
      createV0AuthorityProfile("http://127.0.0.1:3338/", {
        allowInsecureLoopback: true,
      }).mintUrl
    ).toBe("http://127.0.0.1:3338");
    expect(() =>
      createV0AuthorityProfile("http://mint.example", {
        allowInsecureLoopback: true,
      })
    ).toThrow();
  });

  it("uses explicit profile errors for forbidden operations", () => {
    expect(() => rejectV0Operation("cashu-token-send")).toThrowError(
      expect.objectContaining({
        code: "V0_UNSUPPORTED_OPERATION",
        operation: "cashu-token-send",
      })
    );
    expect(() => assertV0NoMultiPartPayment(1)).toThrowError(V0ProfileError);
    expect(() => assertV0NoMultiPartPayment(undefined)).not.toThrow();
  });
});
