export type ServiceProbe = {
  ok: boolean;
  url: string;
  detail: string;
};

export type LiveServiceStatus = {
  ok: boolean;
  mint: ServiceProbe;
  relay: ServiceProbe;
  pairingRelay: ServiceProbe;
  message: string;
};

const DEFAULT_MINT_URL = "http://127.0.0.1:3338";
const DEFAULT_RELAY_URL = "ws://127.0.0.1:3334";
const DEFAULT_PAIRING_RELAY_URL = "ws://127.0.0.1:3335";
const PROBE_TIMEOUT_MS = 4_000;

function supportsBolt11Usd(nut: unknown): boolean {
  if (!nut || typeof nut !== "object") return false;
  const methods = (nut as { methods?: unknown }).methods;
  return (
    Array.isArray(methods) &&
    methods.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as { method?: unknown }).method === "bolt11" &&
        (entry as { unit?: unknown }).unit === "usd"
    )
  );
}

async function probeMint(rawUrl: string): Promise<ServiceProbe> {
  let url: URL;
  try {
    url = new URL("v1/info", rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`);
  } catch (error) {
    return { ok: false, url: rawUrl, detail: `invalid URL: ${String(error)}` };
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        url: rawUrl,
        detail: `/v1/info returned HTTP ${response.status}`,
      };
    }
    const info = (await response.json()) as {
      version?: unknown;
      nuts?: Record<string, unknown>;
    };
    if (
      typeof info.version !== "string" ||
      !info.version.startsWith("Nutshell/")
    ) {
      return { ok: false, url: rawUrl, detail: "not a Nutshell mint" };
    }
    if (!supportsBolt11Usd(info.nuts?.["4"])) {
      return { ok: false, url: rawUrl, detail: "NUT-04 lacks Bolt11/USD" };
    }
    if (!supportsBolt11Usd(info.nuts?.["5"])) {
      return { ok: false, url: rawUrl, detail: "NUT-05 lacks Bolt11/USD" };
    }
    return { ok: true, url: rawUrl, detail: info.version };
  } catch (error) {
    return {
      ok: false,
      url: rawUrl,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeWebSocket(url: string): Promise<void> {
  await new Promise<void>((resolveOpen, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket upgrade timed out"));
    }, PROBE_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolveOpen();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket upgrade failed"));
    });
  });
}

async function probeRelay(rawUrl: string): Promise<ServiceProbe> {
  let relayUrl: URL;
  try {
    relayUrl = new URL(rawUrl);
    if (relayUrl.protocol !== "ws:" && relayUrl.protocol !== "wss:") {
      throw new Error("relay URL must use ws or wss");
    }
  } catch (error) {
    return { ok: false, url: rawUrl, detail: `invalid URL: ${String(error)}` };
  }

  const healthUrl = new URL(relayUrl);
  healthUrl.protocol = relayUrl.protocol === "wss:" ? "https:" : "http:";
  healthUrl.pathname = "/healthz";
  healthUrl.search = "";
  healthUrl.hash = "";
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        url: rawUrl,
        detail: `/healthz returned HTTP ${response.status}`,
      };
    }
    await probeWebSocket(relayUrl.href);
    return { ok: true, url: rawUrl, detail: "healthz and WebSocket ready" };
  } catch (error) {
    return {
      ok: false,
      url: rawUrl,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkLiveV0Services(options?: {
  mintUrl?: string;
  relayUrl?: string;
  pairingRelayUrl?: string;
}): Promise<LiveServiceStatus> {
  const mintUrl =
    options?.mintUrl || process.env.CASHU_SYNC_NUTSHELL_URL || DEFAULT_MINT_URL;
  const relayUrl =
    options?.relayUrl || process.env.CASHU_SYNC_RELAY_URL || DEFAULT_RELAY_URL;
  const pairingRelayUrl =
    options?.pairingRelayUrl ||
    process.env.CASHU_SYNC_PAIRING_RELAY_URL ||
    DEFAULT_PAIRING_RELAY_URL;
  const [mint, relay, pairingRelay] = await Promise.all([
    probeMint(mintUrl),
    probeRelay(relayUrl),
    probeRelay(pairingRelayUrl),
  ]);
  const unavailable = [
    !mint.ok ? `Nutshell ${mint.url}: ${mint.detail}` : "",
    !relay.ok ? `relay ${relay.url}: ${relay.detail}` : "",
    !pairingRelay.ok
      ? `pairing relay ${pairingRelay.url}: ${pairingRelay.detail}`
      : "",
  ].filter(Boolean);
  const ok = unavailable.length === 0;
  return {
    ok,
    mint,
    relay,
    pairingRelay,
    message: ok
      ? `Live v0 services ready: ${mint.detail}; ${relay.detail}`
      : `Live v0 services unavailable. ${unavailable.join(
          "; "
        )}. Start Nutshell, the Go sync relay, and the Go pairing relay, or set CASHU_SYNC_NUTSHELL_URL/CASHU_SYNC_RELAY_URL/CASHU_SYNC_PAIRING_RELAY_URL.`,
  };
}
