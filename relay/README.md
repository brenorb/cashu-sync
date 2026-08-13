# Cashu Sync v0 relay

A private Nostr-compatible relay for Cashu Sync wallet snapshots. It stores signed,
opaque ciphertext events and atomically advances one head per wallet public key. It
does not decrypt snapshots, interpret wallet state, contact a mint, or resolve stale
writes.

## Run

Go 1.26 or later is required.

```sh
go run ./cmd/cashu-sync-relay
```

The process reads three environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CASHU_SYNC_LISTEN_ADDR` | `127.0.0.1:3334` | HTTP/WebSocket bind address |
| `CASHU_SYNC_DB_PATH` | `./data/cashu-sync.db` | Persistent SQLite database |
| `CASHU_SYNC_MAX_HISTORY` | `8` | Revisions retained per wallet (1-100) |

See `.env.example` for a minimal configuration. The process creates the database
directory when needed. `GET /healthz` returns `200 ok` only while SQLite is ready.
SIGINT and SIGTERM stop the HTTP server and WebSocket clients before closing SQLite.

Put the relay behind a TLS reverse proxy for production and preserve the `Host`,
`X-Forwarded-Host`, and `X-Forwarded-Proto` headers so NIP-42 validates the public
relay URL correctly. Persist the directory containing `CASHU_SYNC_DB_PATH`. This
single-process v0 must not share its SQLite file with another relay process.

## Protocol contract

- Accept only kind `30078` events with exactly `d`, `prev`, and `schema` tags.
- Require `d=com.silentlink.cashu-sync.wallet.v0` and `schema=0`.
- Require NIP-42 authentication; an authenticated key can read and write only its
  own events.
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
