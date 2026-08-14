# Cashu Sync v0 relay

A private, purpose-built Nostr-compatible relay operated by Silent Link for Cashu Sync wallet snapshots. It stores signed,
opaque ciphertext events and atomically advances one head per wallet public key. It
does not decrypt snapshots, interpret wallet state, contact a mint, or resolve stale
writes.

## Run

Go 1.26 or later is required.

```sh
go run ./cmd/cashu-sync-relay
```

The process reads these environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CASHU_SYNC_LISTEN_ADDR` | `127.0.0.1:3334` | HTTP/WebSocket bind address |
| `CASHU_SYNC_DB_PATH` | `./data/cashu-sync.db` | Persistent SQLite database |
| `CASHU_SYNC_MAX_HISTORY` | `8` | Revisions retained per wallet (1-100) |
| `CASHU_SYNC_ADMISSION_MODE` | `open` | `open` for loopback-only local testing or `allowlist` for production |
| `CASHU_SYNC_DEMO_PUBLIC_OPEN` | unset | `true` explicitly permits public `open` mode for disposable demos; unsafe |
| `CASHU_SYNC_SERVICE_URL` | none | Canonical public HTTPS or WSS origin; required in allowlist mode |
| `CASHU_SYNC_ALLOWLIST_PATH` | none | Startup-loaded sync-pubkey file; required in allowlist mode |

See `.env.example` for a production-safe configuration. The allowlist contains one
64-character lowercase hexadecimal sync pubkey per line; blank lines and lines
starting with `#` are ignored. It must contain at least one unique pubkey. Updating
the file requires a relay restart; removing a key blocks access but does not delete
its encrypted snapshots. Paired wallets share one sync key, so enroll the wallet
once, not each device.

`open` mode is only for local end-to-end tests and refuses wildcard, LAN, and public
bind addresses. `allowlist` mode admits only listed NIP-42 pubkeys and fixes Khatru's
authentication origin to `CASHU_SYNC_SERVICE_URL`; forwarded host headers cannot
change it. A static GitHub Pages client needs no server secret: it generates its sync
key locally. Production still requires an explicit operator workflow to obtain and
enroll that public key; the current Pages build does not provide that workflow.

For a disposable demo only, `CASHU_SYNC_DEMO_PUBLIC_OPEN=true` permits `open` mode on
a public bind. Anyone who can reach that relay can authenticate a key and write
encrypted snapshots, so never use this mode with real funds or a persistent public
deployment.

The process creates the database directory when needed. `GET /healthz` returns
`200 ok` only while SQLite is ready. SIGINT and SIGTERM stop the HTTP server and
WebSocket clients before closing SQLite.

For production, bind the Go relay to loopback or a private proxy network and use a
firewall so only the TLS reverse proxy can reach it. The proxy must overwrite, not
append, client-supplied `X-Forwarded-For`. Enforce per-IP handshake and connection
limits, a global WebSocket cap, bandwidth and frame-size limits, and idle timeouts at
that trusted edge. Khatru's forwarded-IP helper does not validate trusted proxy hops,
so application admission and rate limits deliberately do not rely on it.

Persist the directory containing `CASHU_SYNC_DB_PATH`, give that volume a quota and
usage alert, and back it up. This single-process v0 must not share its SQLite file
with another relay process. Stored snapshot rows are bounded by the number of sync
pubkeys that have written to that database times `CASHU_SYNC_MAX_HISTORY`; SQLite
and WAL overhead is extra.

## Protocol contract

- Accept only kind `30078` events with exactly `d`, `prev`, and `schema` tags.
- Require `d=com.silentlink.cashu-sync.wallet.v0` and `schema=0`.
- Require NIP-42 authentication and, in production, allowlist admission. An admitted
  key can read and write only its own events.
- Treat empty `prev` as genesis. Otherwise `prev` must equal the current head.
- Accept an exact event retry idempotently. Reject competing children with a
  `conflict:` response and do not broadcast them.
- Retain the head and the latest configured number of revisions. Event content is
  opaque and capped at 256 KiB.

The wallet remains responsible for encryption, signing, merge/retry behavior, and
mint operations. The relay is deliberately only authenticated CAS storage.

## Verify

```sh
go test ./...
go test -race ./...
go vet ./...
go build ./cmd/cashu-sync-relay
```
