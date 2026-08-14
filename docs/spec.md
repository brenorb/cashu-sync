# Cashu Sync v0 protocol specification

Status: **Implemented v0 contract**

## 1. Purpose and scope

Cashu Sync v0 lets one user control the same Silent Link wallet from paired PWA installations. The protocol synchronizes recoverable wallet state and Bolt11 USD accounting history without giving the relay plaintext access.

V0 supports exactly:

- one configured authority mint, a Nutshell origin using the `usd` unit;
- Bolt11 minting value into the wallet;
- Bolt11 melting value out of the wallet;
- pairing fully authorized wallets;
- encrypted whole-wallet synchronization;
- interrupted-operation recovery;
- backup and device-loss recovery.

It has no peer-to-peer path. It does not expose Cashu token send, receive, redeem, P2PK, payment requests, Nostr peer flows, user-visible swaps, mint discovery, mint or unit switching, multi-mint/MPP, NUT-29 batch mint, Bolt12, on-chain, LNURL, or Lightning-address behavior.

## 2. Participants

### Wallet client

The client is a phone-first PWA based on Cashu.me. Two or more installed PWAs may share one wallet under the control of the same user. A future CLI is exploration, not a v0 implementation or compatibility claim.

Wallet clients hold and process all plaintext secrets. They create, sign, encrypt, decrypt, validate, and apply snapshots locally.

### Cashu mint

V0 integrates against [Nutshell](https://github.com/cashubtc/nutshell) as the reference mint. The mint is authoritative for quotes and whether proofs are `UNSPENT`, `PENDING`, or `SPENT`. The reproducible local profile is defined in [the Nutshell reference](./research/nutshell-reference.md).

### Silent Link sync relay

Silent Link operates one private, purpose-built Nostr-compatible relay backed by SQLite. It authenticates clients, stores opaque events, serves the current head, and atomically rejects stale snapshot children. It is not a generic public relay and never decrypts wallet content.

## 3. Core invariants

1. The Cashu mint is authoritative for monetary state.
2. The relay is authoritative only for which encrypted snapshot event is the current synchronization head.
3. Every state-changing mint or melt begins from the current relay head and a current USD Bolt11 quote.
4. A wallet MUST obtain a successful relay compare-and-swap for a prepared pending operation before submitting that state-changing request to the mint.
5. At most one unresolved mint or melt operation exists in a snapshot.
6. A failed or stale compare-and-swap causes zero state-changing mint, melt, or swap submissions. Read-only quote and reconciliation calls may occur before it.
7. Proofs, seed material, quote IDs, amounts, history, and operation details are encrypted before leaving a wallet for the relay.
8. A new snapshot never removes an unspent proof unless the mint operation or mint reconciliation justifies the change.
9. New outputs and recovery material become durable before old inputs are marked spent locally.
10. Every paired wallet has equal authority in v0.

## 4. Keys and recovery material

### Cashu master seed

The wallet uses a twelve-word BIP39 mnemonic and versioned NUT-13 derivation for deterministic Cashu secrets and blinding factors. It selects the derivation from the keyset ID: version `01` keysets use the HMAC-SHA256 construction and version `00` keysets use the legacy BIP32 construction. Counters are independent per mint and keyset. V0 carries the mnemonic inside the encrypted full-recovery bundle; it does not expose a separate mnemonic export in the product UI.

### Sync secret

The wallet creates a random dedicated 32-byte secp256k1/Nostr secret. It is independent from the social Nostr identity and from Cashu proof derivation. All paired v0 wallets share it.

The sync secret is used to:

- derive the dedicated sync pubkey;
- sign snapshot events;
- NIP-44-v2 self-encrypt and decrypt snapshot content;
- authenticate to the private relay through NIP-42.

### Backup semantics

V0 exposes one **encrypted full-recovery bundle**. It contains the mnemonic, sync secret, authority mint URL, relay URL, schema version, and last remembered head. “Full” means it carries the complete authority required to reconstruct the synchronized wallet; the encrypted wallet snapshot remains on the relay and the mint remains authoritative for monetary state.

Export requires a user-supplied passphrase and confirmation. The bundle is encrypted with PBKDF2-HMAC-SHA256 and AES-256-GCM before download. Plaintext seed or pairing material MUST NOT appear in URLs, analytics, logs, relay events, or clipboard operations performed without explicit user action. A standalone mnemonic export and mnemonic-only whole-wallet recovery are deferred to the roadmap.

## 5. Pairing

Pairing grants full authority; v0 has no roles or revocation. It is a two-QR exchange between PWA installations controlled by one user, not a payment between users.

1. On the joining wallet, the user creates QR 1: an ephemeral public key, random challenge, and five-minute expiry. It contains no wallet secret.
2. On an existing wallet, the user imports QR 1's canonical payload and explicitly creates a response. The current PWA displays both QRs but uses the text fields below them for local copy/paste input; camera scanning is future UI work.
3. The existing wallet creates QR 2: an end-to-end encrypted payload containing the Cashu mnemonic, sync secret, authority mint URL, relay URL, schema version, and current head ID, bound to QR 1's key and challenge.
4. The joining wallet imports QR 2's canonical payload, validates and decrypts it locally, imports it only into an empty wallet, authenticates to the relay, fetches the current snapshot, and validates it.
5. It resumes or reconciles a pending operation before enabling a new mint or melt.
6. Both wallets delete ephemeral pairing material after completion or expiry.

A paired wallet may pair another wallet because all v0 wallets have equal authority.

## 6. Snapshot model

V0 uses one complete encrypted snapshot per revision. It does not merge snapshots or model proofs as an event graph.

### Nostr envelope

```json
{
  "kind": 30078,
  "pubkey": "<dedicated shared sync pubkey>",
  "created_at": 1780000000,
  "tags": [
    ["d", "com.silentlink.cashu-sync.wallet.v0"],
    ["prev", "<current event id or empty for genesis>"],
    ["schema", "0"]
  ],
  "content": "<NIP-44-v2 ciphertext>",
  "id": "<Nostr event id>",
  "sig": "<Schnorr signature>"
}
```

Only routing and concurrency metadata is public. Tags MUST NOT expose revision numbers, balances, mint URLs, quote IDs, proofs, counters, operation type, or device identity.

### Encrypted content

```json
{
  "schema": 0,
  "revision": 42,
  "previous_event_id": "<same value as outer prev tag>",
  "mint": "https://configured-nutshell.example",
  "unit": "usd",
  "proofs": [],
  "counters": {},
  "quotes": [],
  "history": [],
  "pending_operation": null
}
```

The versioned TypeScript schema validates every field and rejects unknown schema versions. The client verifies that the decrypted `previous_event_id`, local remembered head, and outer `prev` tag agree. Cross-language fixtures for a future CLI remain roadmap work.

## 7. Relay compare-and-swap

A generic Nostr relay is insufficient because NIP-01 addressable-event replacement is last-write-wins and has no conditional write. The v0 relay adds one rule.

In one SQLite transaction, for `(pubkey, d)`:

1. Return success for an already stored identical event.
2. Read the current head.
3. Require the incoming `prev` tag to equal that head, or empty for genesis.
4. Insert the immutable event.
5. Advance the head pointer.
6. Commit before returning `OK true` and broadcasting the event.

A stale child receives `OK false` with a conflict reason. It is not stored or broadcast. The client refetches and recomputes; it MUST NOT contact Nutshell following this rejection.

There is no expiring lease. A timeout cannot fence a wallet that may still contact the mint, so an unresolved pending operation remains the operation slot until reconciliation proves how to finish or clear it.

## 8. Synchronization lifecycle

A wallet fetches, validates, decrypts, and applies the current snapshot:

- on startup or foreground resume;
- after pairing or recovery;
- before every mint or melt;
- after a relay conflict.

Snapshot application occurs in one local IndexedDB transaction. The client rejects invalid signatures, decryption failures, wrong sync pubkeys, wrong mint, rollback from a remembered head, inconsistent revisions, and malformed wallet state.

After applying a snapshot, the wallet resumes any pending operation through Nutshell quote lookup and exact prepared-output recovery before starting another operation.

V0 correctness uses explicit relay pulls and REST quote/proof reconciliation. While the wallet is open, it also keeps an authenticated relay-head subscription to trigger the same serialized pull automatically; reconnects and foreground/pre-operation pulls remain the correctness fallback. NUT-17 notification handling is still deferred.

## 9. Pending-operation journal

The snapshot contains either `null` or one encrypted pending operation with:

- random operation ID;
- `mint` or `melt` type;
- phase;
- quote ID and method;
- full ordered request material needed to submit the operation again, including quote, inputs, outputs, signature, and `prefer_async` where applicable;
- optional canonical request hash for comparison and diagnostics;
- selected input proofs for melt;
- reserved NUT-13 counters and deterministic output material;
- locally known response and quote state;
- creation and update timestamps.

The minimum phases are `prepared`, `submitted`, `response_recorded`, and `needs_reconciliation`.

Another wallet encountering a pending operation reconciles it before starting anything else. It never clears the slot merely because time passed.

## 10. Mint flow

1. Fetch and apply the current relay head.
2. Reconcile an existing pending operation, if any.
3. Obtain or refresh the Nutshell mint quote.
4. Reserve NUT-13 counters and deterministic blinded outputs.
5. Persist the prepared journal locally.
6. Publish a snapshot containing the prepared operation with `prev = current head`.
7. Continue only after relay `OK true`.
8. Submit the exact mint request to Nutshell.
9. Persist the response and new proofs locally.
10. Publish a final snapshot containing the new state and clearing the pending operation.

If the final snapshot conflicts, the wallet fetches the new head and reconciles; it never discards the locally durable response or newly issued proofs.

## 11. Melt flow

1. Fetch and apply the current relay head.
2. Reconcile an existing pending operation, if any.
3. Obtain or refresh the Nutshell melt quote.
4. Select reconciled input proofs and deterministic change outputs.
5. Persist the prepared journal locally.
6. Publish a snapshot containing the prepared operation with `prev = current head`.
7. Continue only after relay `OK true`.
8. Submit the exact melt request to Nutshell.
9. Persist the response and change proofs before marking inputs spent locally.
10. Publish a final snapshot containing the new state and clearing the pending operation.

The reference Nutshell profile enables NUT-19 with a one-hour TTL. Within that window, a wallet may repeat the exact mint or melt request to obtain a cached successful response. A NUT-19 cache miss or expiry is not proof that the first request failed. V0 journal reconciliation uses quote state plus wallet-side NUT-13 material and NUT-09 restoration for the exact prepared mint outputs. Broader NUT-07 proof scanning is not part of the current product flow.

## 12. Recovery

### Existing wallet restart

Load the local journal, fetch the relay head, and reconcile any discrepancy or pending operation before enabling mint/melt.

### Paired wallet recovery

Fetch and decrypt the current snapshot, atomically import it locally, reconcile it with Nutshell, then continue normal synchronization.

### Full-recovery bundle

On a fresh or empty PWA, decrypt the bundle locally, restore the shared authority and endpoints, fetch the relay snapshot, atomically import it, and resume or reconcile any pending operation with Nutshell. A wrong passphrase, modified bundle, unavailable relay, or nonempty destination fails closed.

The bundle does not embed the latest snapshot. Successful from-scratch v0 recovery therefore requires the Silent Link relay to retain the encrypted wallet head. NUT-09 is used to recover the exact outputs of an interrupted journaled mint. A broad mnemonic-only NUT-13 scan is future work and is not exposed by the v0 UI.

## 13. Relay policy and deployment

V0 runs one Go relay process and one persistent SQLite database behind TLS/WSS.

The relay:

- requires NIP-42 authentication for reads and writes;
- in production, admits only sync pubkeys loaded from the operator allowlist;
- permits access only to the authenticated sync pubkey;
- accepts only kind `30078`, the exact v0 `d` value, valid signatures, bounded clock skew, and bounded ciphertext size;
- rate-limits by admitted pubkey; the trusted TLS edge independently limits source IPs, handshakes, connections, frames, and bandwidth;
- stores the current event plus a small bounded rollback history;
- backs up encrypted SQLite data;
- never decrypts events or projects wallet state.

GitHub Pages may host the static wallet PWA. It cannot host the stateful WebSocket relay.

Open admission is permitted only for local end-to-end testing and only on a loopback bind. Production uses a nonempty startup-loaded allowlist and a fixed canonical HTTPS/WSS service origin for NIP-42; it never derives the authentication origin from forwarded request headers. Paired devices and full-bundle recovery retain the already admitted sync key. A future mnemonic-only recovery path would create a new key requiring operator enrollment.

The production Go port is reachable only from its TLS reverse proxy. That proxy overwrites inbound `X-Forwarded-For`, enforces per-IP and global WebSocket limits, and bounds handshake rate, idle connections, frame size, and bandwidth. The persistent SQLite volume has a quota and usage alert in addition to backups.

## 14. Security and privacy limitations

- Every paired device has the seed and can spend all funds.
- V0 cannot revoke a device that already copied the seed.
- The shared sync pubkey lets the relay link that wallet's activity.
- NIP-44 does not hide timestamps, event size, IP address, or access patterns.
- Silent Link operating both wallet service and relay creates metadata correlation; it still cannot decrypt wallet state.
- Relay deletion or rollback prevents full-bundle snapshot recovery until relay service is restored. The bundle protects authority; it is not a second copy of the full encrypted snapshot.
- Relay availability gates new mint/melt operations because CAS is the concurrency fence. Recovery and read-only local display may remain available.

## 15. Acceptance tests

The v0 test boundary covers:

- genesis, child, duplicate, stale-child, concurrent-child, and restart-safe CAS behavior;
- invalid signature, wrong kind/`d`, oversized event, and unauthenticated access rejection;
- unsafe open-mode binds and empty or malformed production allowlists fail at startup;
- rotated unadmitted pubkeys create no relay state or rate-limiter entries;
- paired clients sharing one admitted sync key both work, and pubkey limits survive source-IP changes;
- the canonical NIP-42 service origin cannot be changed through forwarded host headers;
- NIP-44 round trip, tamper rejection, wrong-key rejection, and official vector compatibility;
- schema validation and atomic local snapshot import;
- pairing success, invalid challenge, replay rejection, and cleanup;
- prepared journal reaches the relay before its state-changing Nutshell submission;
- a failed CAS produces zero state-changing `/v1/mint/bolt11`, `/v1/melt/bolt11`, or `/v1/swap` submissions;
- crash recovery at every mint/melt boundary;
- exact-output NUT-09 recovery and quote reconciliation for interrupted journaled operations against the reference Nutshell mint;
- the live browser acceptance path pairs two isolated wallets, mints, synchronizes across devices, melts, synchronizes again, and restores a third fresh wallet;
- PWA update cannot replace code during an in-progress operation.

## 16. Implementation baseline

The selected wallet base is Cashu.me at commit `f4a3f3221be0b7b818c71ece23d9cb472f03f4ad`. The rationale and required hardening are documented in [the wallet evaluation](./research/wallet-base.md).

The reference mint is Nutshell `0.20.3` at commit `18539020b4fa473ad8ad440e210720d2aaf8401a`. Integration tests use the multi-platform image `cashubtc/nutshell:0.20.3@sha256:f039b0e61f64d67c7212f5472eb5d021c3703cd9e72170aa924906ce6bd1f2ed`, a USD FakeWallet backend, and Redis-backed NUT-19. NUT-13 is wallet behavior and is intentionally not advertised by the mint's NUT-06 response.

The relay uses Khatru for Nostr protocol plumbing and implements the SQLite compare-and-swap and admission policy described above. The implementation must remain compatible with the normative behavior even if the framework changes.
