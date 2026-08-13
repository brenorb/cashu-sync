export const V0_MINT_UNIT = "usd" as const;
export const V0_PAYMENT_METHOD = "bolt11" as const;

export const V0_FEATURES = Object.freeze({
  cashuTokens: false,
  p2p: false,
  p2pk: false,
  paymentRequests: false,
  nostrPeerFlows: false,
  bolt12: false,
  onchain: false,
  lnurl: false,
  multiMint: false,
  multiPartPayments: false,
  batchMint: false,
});

export type V0ForbiddenOperation =
  | "cashu-token-send"
  | "cashu-token-receive"
  | "cashu-token-redeem"
  | "p2pk"
  | "payment-request"
  | "nostr-peer"
  | "bolt12"
  | "onchain"
  | "lnurl"
  | "mint-add"
  | "mint-remove"
  | "mint-switch"
  | "unit-switch"
  | "multi-mint"
  | "multi-part-payment"
  | "batch-mint"
  | "unsupported-request";

export type V0ProfileErrorCode =
  | "V0_UNSUPPORTED_OPERATION"
  | "V0_INVALID_AUTHORITY_MINT"
  | "V0_INVALID_UNIT";

export class V0ProfileError extends Error {
  constructor(
    public readonly code: V0ProfileErrorCode,
    public readonly operation: V0ForbiddenOperation,
    message?: string
  ) {
    super(message ?? `${operation} is not available in the v0 profile`);
    this.name = "V0ProfileError";
  }
}

const V0_AUTHORITY_PROFILE = Symbol("V0AuthorityProfile");

export interface V0AuthorityProfile {
  readonly mintUrl: string;
  readonly unit: typeof V0_MINT_UNIT;
  readonly paymentMethod: typeof V0_PAYMENT_METHOD;
  readonly [V0_AUTHORITY_PROFILE]: true;
}

export interface V0AuthorityProfileOptions {
  /** Test infrastructure only; production authorities must use HTTPS. */
  readonly allowInsecureLoopback?: boolean;
}

export function normalizeV0MintUrl(
  mintUrl: string,
  options: V0AuthorityProfileOptions = {}
): string {
  let parsed: URL;
  try {
    parsed = new URL(mintUrl.trim());
  } catch {
    throw new V0ProfileError(
      "V0_INVALID_AUTHORITY_MINT",
      "mint-add",
      "The v0 authority mint must be a valid URL origin"
    );
  }

  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  const permittedProtocol =
    parsed.protocol === "https:" ||
    (options.allowInsecureLoopback &&
      parsed.protocol === "http:" &&
      isLoopback);
  const isOriginOnly =
    (parsed.pathname === "/" || parsed.pathname === "") &&
    !parsed.search &&
    !parsed.hash &&
    !parsed.username &&
    !parsed.password;
  if (!permittedProtocol || !isOriginOnly) {
    throw new V0ProfileError(
      "V0_INVALID_AUTHORITY_MINT",
      "mint-add",
      "The v0 authority mint must be an HTTPS origin"
    );
  }
  return parsed.origin;
}

export function createV0AuthorityProfile(
  mintUrl: string,
  options: V0AuthorityProfileOptions = {}
): V0AuthorityProfile {
  const profile = {
    mintUrl: normalizeV0MintUrl(mintUrl, options),
    unit: V0_MINT_UNIT,
    paymentMethod: V0_PAYMENT_METHOD,
  } as V0AuthorityProfile;
  Object.defineProperty(profile, V0_AUTHORITY_PROFILE, { value: true });
  return Object.freeze(profile);
}

export function assertV0AuthorityMint(
  profile: V0AuthorityProfile,
  mintUrl: string
): void {
  if (profile?.[V0_AUTHORITY_PROFILE] !== true) {
    throw new V0ProfileError(
      "V0_INVALID_AUTHORITY_MINT",
      "mint-add",
      "Authority mint bootstrap requires a validated v0 profile"
    );
  }
  const allowInsecureLoopback = profile.mintUrl.startsWith("http://");
  if (
    normalizeV0MintUrl(mintUrl, { allowInsecureLoopback }) !== profile.mintUrl
  ) {
    throw new V0ProfileError(
      "V0_INVALID_AUTHORITY_MINT",
      "mint-switch",
      "Only the configured authority mint is available in v0"
    );
  }
}

export function assertV0Unit(
  unit: string
): asserts unit is typeof V0_MINT_UNIT {
  if (unit !== V0_MINT_UNIT) {
    throw new V0ProfileError(
      "V0_INVALID_UNIT",
      "unit-switch",
      "Only USD is available in v0"
    );
  }
}

export function assertV0NoMultiPartPayment(amount?: number): void {
  if (amount !== undefined) rejectV0Operation("multi-part-payment");
}

export function rejectV0Operation(operation: V0ForbiddenOperation): never {
  throw new V0ProfileError("V0_UNSUPPORTED_OPERATION", operation);
}

export function parseV0Bolt11Request(rawRequest: string): string {
  const request = rawRequest.trim();
  const candidate = /^lightning:/i.test(request)
    ? request.slice("lightning:".length)
    : request;

  if (!/^ln(?:bc|tb|tbs|bcrt)1/i.test(candidate)) {
    rejectV0Operation("unsupported-request");
  }
  return candidate;
}
