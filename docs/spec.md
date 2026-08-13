# Cashu Sync v0 protocol specification

Status: **Accepted for implementation**

## 1. Purpose and scope

Cashu Sync v0 lets one person use the same Silent Link wallet from multiple paired PWA installations. The protocol synchronizes recoverable wallet state and accounting history without giving the relay plaintext access.

V0 supports exactly:

- one configured Nutshell mint;
- minting value into the wallet;
- melting value out of the wallet;
- pairing fully authorized wallets;
- encrypted whole-wallet synchronization;
- interrupted-operation recovery;
- backup and device-loss recovery.

It does not expose send, receive, peer transfer, user-visible swap, mint discovery, or multi-mint behavior.

## 2. Participants

### Wallet client

The initial client is a phone-first PWA based on Cashu.me. Two or more installed PWAs may share one wallet. The sync format must not depend on browser-only behavior so a future CLI can interoperate.

Wallet clients hold and process all plaintext secrets. They create, sign, encrypt, decrypt, validate, and apply snapshots locally.

### Cashu mint

V0 integrates against [Nutshell](https://github.com/cashubtc/nutshell) as the reference mint. The mint is authoritative for quotes and whether proofs are `UNSPENT`, `PENDING`, or `SPENT`.

### Silent Link sync relay

Silent Link operates one private Nostr-compatible relay backed by SQLite. It authenticates clients, stores opaque events, serves the current head, and atomically rejects stale snapshot children. It never decrypts wallet content.

## 3. Core invariants

1. The Cashu mint is authoritative for monetary state.
2. The relay is authoritative only for which encrypted snapshot event is the current synchronization head.
3. Every state-changing mint or melt begins from the current relay head and reconciled mint state.
4. A wallet MUST obtain a successful relay compare-and-swap for a prepared pending operation before contacting the mint.
5. At most one unresolved mint or melt operation exists in a snapshot.
6. A failed or stale compare-and-swap causes zero mint calls.
7. Proofs, seed material, quote IDs, amounts, history, and operation details are encrypted before leaving a wallet for the relay.
8. A new snapshot never removes an unspent proof unless the mint operation or mint reconciliation justifies the change.
9. New outputs and recovery material become durable before old inputs are marked spent locally.
10. Every paired wallet has equal authority in v0.

## 4. Keys and recovery material

### Cashu master seed

The wallet uses a twelve-word BIP39 mnemonic and standard NUT-13 derivation for deterministic Cashu secrets and blinding factors. The user can deliberately reveal/export the mnemonic and import it later.

### Sync secret

The wallet creates a random dedicated 32-byte secp256k1/Nostr secret. It is independent from the social Nostr identity and from Cashu proof derivation. All paired v0 wallets share it.

The sync secret is used to:

- derive the dedicated sync pubkey;
- sign snapshot events;
- NIP-44-v2 self-encrypt and decrypt snapshot content;
- authenticate to the private relay through NIP-42.

### Backup semantics

The wallet offers two explicit exports:

- **Twelve-word funds backup:** recovers deterministic Cashu funds through NUT-13/NUT-09, but not the random sync secret or encrypted history.
- **Encrypted full-recovery bundle:** contains the mnemonic, sync secret, mint URL, relay URL, schema version, and last remembered head. It recovers funds plus synchronized state.

Export requires deliberate confirmation and a user-supplied encryption passphrase. Plaintext seed or pairing material MUST NOT appear in URLs, analytics, logs, relay events, or clipboard operations performed without explicit user action.

## 5. Pairing

Pairing grants full authority; v0 has no roles or revocation.

1. The new wallet creates an ephemeral pairing key and displays its public key and challenge through QR/deeplink.
2. An existing wallet verifies explicit user approval.
3. The existing wallet sends an end-to-end encrypted pairing payload containing the Cashu mnemonic, sync secret, mint URL, relay URL, schema version, and current head ID.
4. The new wallet imports the payload locally, authenticates to the relay, fetches the named/current snapshot, and validates it.
5. It reconciles proofs and pending operations with Nutshell before showing an available balance or enabling mint/melt.
6. Both wallets delete ephemeral pairing material after completion.

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
  "unit": "sat",
  "proofs": [],
  "counters": {},
  "quotes": [],
  "history": [],
  "pending_operation": null
}
```

The exact field schemas require versioned TypeScript and Go fixtures before interoperability is claimed. Unknown schema versions are rejected. The client verifies that the decrypted `previous_event_id`, local remembered head, and outer `prev` tag agree.

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
- after a relay conflict;
- when notified of a new head while active.

Snapshot application occurs in one local IndexedDB transaction. The client rejects invalid signatures, decryption failures, wrong sync pubkeys, wrong mint, rollback from a remembered head, inconsistent revisions, and malformed wallet state.

After applying a snapshot, the wallet reconciles any pending operation and the proofs relevant to the requested action with Nutshell.

## 9. Pending-operation journal

The snapshot contains either `null` or one encrypted pending operation with:

- random operation ID;
- `mint` or `melt` type;
- phase;
- quote ID and method;
- exact request material or canonical request hash;
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

Uncertain responses are reconciled through quote state, NUT-07, NUT-09/NUT-13 restoration, and NUT-19 where supported.

## 12. Recovery

### Existing wallet restart

Load the local journal, fetch the relay head, and reconcile any discrepancy or pending operation before enabling mint/melt.

### Paired wallet recovery

Fetch and decrypt the current snapshot, atomically import it locally, reconcile it with Nutshell, then continue normal synchronization.

### Full-recovery bundle

Decrypt the bundle, restore sync credentials and endpoints, fetch the relay snapshot, then run Nutshell reconciliation and deterministic restoration as a completeness check.

### Mnemonic-only recovery

Derive and scan deterministic outputs through NUT-13/NUT-09, then check proof state through NUT-07. Create a new sync secret and genesis snapshot. Accounting history, labels, and unresolved operation context may be lost.

## 13. Relay policy and deployment

V0 runs one Go relay process and one persistent SQLite database behind TLS/WSS.

The relay:

- requires NIP-42 authentication for reads and writes;
- permits access only to the authenticated sync pubkey;
- accepts only kind `30078`, the exact v0 `d` value, valid signatures, bounded clock skew, and bounded ciphertext size;
- rate-limits by authenticated pubkey and IP;
- stores the current event plus a small bounded rollback history;
- backs up encrypted SQLite data;
- never decrypts events or projects wallet state.

GitHub Pages may host the static wallet PWA. It cannot host the stateful WebSocket relay.

## 14. Security and privacy limitations

- Every paired device has the seed and can spend all funds.
- V0 cannot revoke a device that already copied the seed.
- The shared sync pubkey lets the relay link that wallet's activity.
- NIP-44 does not hide timestamps, event size, IP address, or access patterns.
- Silent Link operating both wallet service and relay creates metadata correlation; it still cannot decrypt wallet state.
- Relay deletion or rollback can impair fast sync. Nutshell restoration and the user's backup are the recovery backstops.
- Relay availability gates new mint/melt operations because CAS is the concurrency fence. Recovery and read-only local display may remain available.

## 15. Required tests

Implementation is not v0-ready until automated tests prove:

- genesis, child, duplicate, stale-child, concurrent-child, and restart-safe CAS behavior;
- invalid signature, wrong kind/`d`, oversized event, and unauthenticated access rejection;
- NIP-44 round trip, tamper rejection, wrong-key rejection, and official vector compatibility;
- schema validation and atomic local snapshot import;
- pairing success, invalid challenge, replay rejection, and cleanup;
- prepared journal reaches the relay before any Nutshell call;
- a failed CAS produces zero Nutshell calls;
- crash recovery at every mint/melt boundary;
- NUT-09/NUT-13 restore, NUT-07 reconciliation, and counter-gap scanning against the reference Nutshell mint;
- two paired wallets racing from the same head result in exactly one mint call;
- PWA update cannot replace code during an in-progress operation.

## 16. Implementation baseline

The selected wallet base is Cashu.me at commit `f4a3f3221be0b7b818c71ece23d9cb472f03f4ad`. The rationale and required hardening are documented in [the wallet evaluation](./research/wallet-base.md).

The relay should reuse a Nostr framework for protocol plumbing and implement only the SQLite compare-and-swap policy. The implementation must remain compatible with the normative behavior above even if the chosen framework changes.

