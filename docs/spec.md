# Cashu Sync protocol specification

Status: **Proposed / pre-implementation**

## 1. Abstract

Cashu is a bearer-token protocol. A wallet that loses its proofs can lose access to its balance even when the mint remains healthy. Cashu Sync adds an end-to-end encrypted state layer to white-label Silent Link wallets so that multiple user-controlled PWA and CLI installations can reconstruct and update the same logical wallet without asking the mint to manage a plaintext user account.

The protocol is multiwriter and uses optimistic concurrency. Each operation begins by synchronizing and validating the current event set. State is represented as encrypted, signed transitions with UTXO-like dependencies. Independent transitions coexist; conflicting consumption of the same state object is reconciled against the mint, which remains the authority for Cashu proof spendability.

Cashu Sync prioritizes recovery of unspent value and metadata privacy over atomic coupling between mint operations and sync storage.

## 2. Motivation

Cashu's bearer model is valuable for privacy, but creates difficult wallet UX:

- Losing the only device can mean losing all proofs.
- Copying the wallet to another device can create divergent local databases.
- A user may intentionally operate several PWA and CLI wallet installations that all need a current view of the same proofs.
- A crash can occur after the mint accepts inputs but before the wallet persists the new outputs.
- A mint or melt operation on one installation can change wallet state while another installation is offline.
- A mint should not need a plaintext account or balance table per user.

Existing protocols provide important building blocks:

- [NUT-07](https://github.com/cashubtc/nuts/blob/main/07.md): proof state checks.
- [NUT-09](https://github.com/cashubtc/nuts/blob/main/09.md): restoration of blind signatures.
- [NUT-13](https://github.com/cashubtc/nuts/blob/main/13.md): BIP39-based deterministic secrets and blinding factors.
- [NUT-17](https://github.com/cashubtc/nuts/blob/main/17.md): state-change subscriptions.
- [NUT-19](https://github.com/cashubtc/nuts/blob/main/19.md): cached responses for replaying interrupted requests.
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md): authenticated encrypted Nostr payloads.
- [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md): dedicated connection keys and relay-based request/response.

Cashu Sync combines these ideas while defining stronger recovery and multi-device semantics.

## 3. Goals

### 3.1 Required goals

1. Recover unspent proofs after loss of all active devices.
2. Allow every authorized device to read and write wallet state.
3. Require each operation to synchronize and validate state before acting.
4. Prevent an older view from silently deleting a newer unspent proof.
5. Reconcile inconsistent local state using the mint as the spendability authority.
6. Keep proofs, counters, quotes, and wallet metadata confidential from storage relays.
7. Avoid a stable social Nostr identity for wallet activity.
8. Remain usable when mint and sync writes cannot be committed atomically.
9. Support QR, deeplink, and copy/paste device pairing.
10. Let the user export or download a master-seed backup through a wallet and import it for full recovery.

### 3.2 Non-goals

- Preventing a stolen, already-authorized device from racing to spend bearer proofs.
- Recovering value after the mint permanently disappears.
- Supporting arbitrary mints. The first deployment targets a known mint with a declared capability set.
- Hiding all traffic metadata from a relay operator.
- Providing Byzantine consensus among devices or relays.
- Preserving an indefinite transaction history.
- Supporting peer-to-peer Cashu token sending or receiving.
- Exposing wallet-initiated proof swaps. The first version supports mint and melt accounting only.

## 4. Core invariants

### 4.1 Multiwriter optimistic concurrency

Every authorized device MAY write. There is no permanent primary writer.

Each wallet client MUST fetch and validate the retained event set on startup, pairing, or restore. While active, it SHOULD subscribe to relay updates, or poll when subscriptions are unavailable. These background updates improve freshness but do not replace the mandatory operation preflight below.

Before mint, melt, or any other supported state-changing operation, a device MUST:

1. Fetch all events after its latest trusted checkpoint.
2. Validate event signatures and encrypted payload authentication.
3. Reconstruct the latest event-derived wallet state.
4. Reconcile relevant proofs and pending operations with the mint.
5. Select inputs and counters only from the reconciled state.

The protocol does not require a single global `head` for every operation. Each transition names the specific state objects it consumes. Concurrent operations over disjoint objects can coexist. Two transitions that consume the same object form a localized conflict.

### 4.2 Mint authority

The mint is the source of truth for whether a proof is `UNSPENT`, `PENDING`, or `SPENT`. Sync events are evidence and recovery material, not an independent ledger of value.

### 4.3 Asymmetric failure tolerance

Cashu Sync treats inconsistencies asymmetrically:

- A stale proof that is already spent is safe but may temporarily overstate the balance. It can be removed after a state check.
- An omitted proof that is still unspent is dangerous because the wallet may lose access to real value.

Implementations MUST optimize for never irrecoverably omitting newly issued unspent proofs.

### 4.4 Privacy over strict atomicity

Sync publication SHOULD NOT be embedded in the same HTTP request as a Cashu mint operation. A persistent sync namespace or commit identifier attached to mint requests can let the mint correlate issuance and redemption activity.

The protocol accepts short-lived, repairable sync inconsistency in exchange for weaker linkage between Cashu operations and sync storage.

## 5. Trust and threat model

### 5.1 Trusted

- At least one authorized wallet device behaves correctly during initial wallet creation or recovery.
- The mint correctly reports proof state and honors successful Cashu operations.
- The BIP39 mnemonic has sufficient entropy and is kept secret.

### 5.2 Untrusted or fallible

- Relays may delete, delay, reorder, duplicate, replay, or fork events.
- A relay may return an older but internally valid view.
- Devices may crash between any two local, mint, or relay operations.
- Devices may be offline for months.
- Multiple devices may act on stale state, although simultaneous user-initiated writes are assumed to be uncommon.
- The mint or relay operator may observe timing, IP addresses, event sizes, authors, and access patterns.

### 5.3 Out of scope

A device that possesses spendable proofs and the raw BIP39 seed has full wallet authority. Device revocation cannot claw back secrets already copied to that device. Recovery from theft requires moving all still-unspent proofs to a new seed and sync epoch.

## 6. Key hierarchy

### 6.1 Root material

The user creates a 12-word BIP39 mnemonic. BIP39 derives a 64-byte seed using PBKDF2-HMAC-SHA512.

The BIP39 seed has two independent uses:

1. NUT-13 derives Cashu secrets and blinding factors according to the standard.
2. A domain-separated KDF derives the Cashu Sync root.

Conceptually:

```text
BIP39 mnemonic
    └── PBKDF2-HMAC-SHA512 → BIP39 seed
            ├── NUT-13 → Cashu secret + blinding factor per keyset/counter
            └── KDF("cashu-sync/root/v1") → sync root
```

The exact Cashu Sync KDF, salt, byte encoding, and test vectors remain open. Implementations MUST NOT reuse proof secrets or blinding factors as sync encryption keys or record locators.

### 6.2 Wallet group key

The sync root derives or protects a wallet group keypair `W`. All fully authorized devices receive `W_priv` during pairing.

State events can be:

- signed by a device-specific signing key `D_i`; and
- NIP-44 encrypted from `D_i` to `W_pub`.

Any device holding `W_priv` can decrypt an event using its author's public key. Device signatures preserve per-device authorship without requiring every device to share the same Nostr signing key.

### 6.3 Device keys

Each device generates a random device signing keypair locally. Device keys SHOULD NOT be deterministically derived from the shared seed; otherwise one compromised device could derive and impersonate all other device identities.

An authorization record grants a device pubkey one or more roles:

- `writer`: read, decrypt, and publish wallet state.
- `pairer`: authorize another device.
- `admin`: rotate epochs or revoke device certificates.

Role enforcement is still open. The first version MAY make every paired device a full writer and pairer.

### 6.4 Writer provisioning

A writer that creates standard NUT-13 outputs needs the raw BIP39 seed, or equivalent derivation authority. Pairing MAY transfer the raw seed inside an E2E-encrypted bundle without displaying or transferring the mnemonic words themselves.

This improves UX and avoids exposing words in a QR code, but is not least privilege: the raw seed is sufficient to operate and recover the Cashu wallet.

### 6.5 User-controlled backup and restore

Every full wallet client MUST provide an explicit flow for the user to export or download the twelve-word BIP39 mnemonic as the master-seed backup and to import it on a replacement device. The export flow SHOULD require deliberate user confirmation, warn that anyone with the words controls the wallet, and avoid leaving an unencrypted temporary copy where the platform permits.

The master-seed backup is independent of any one PWA, CLI installation, local database, or relay. Wallet clients MUST derive it or retrieve it locally and MUST NOT upload it to the sync relay as plaintext. An encrypted pairing bundle sent directly to a newly authorized device is a separate mechanism from the user's offline backup.

## 7. State model

### 7.1 Event-sourced object graph

The proposed model resembles UTXO state more than a Git branch.

Each valid state object is created by one event and may be consumed by later events. A transition identifies its consumed object IDs and creates replacement objects. The current candidate set consists of created objects that are not consumed by a later valid transition.

Independent transitions over disjoint objects commute and do not require a global merge commit.

### 7.2 Why this does not eliminate every fork

The model eliminates unnecessary global forks, but it cannot prevent two stale devices from attempting to consume the same object. Such transitions form a localized conflict set.

Conflict resolution uses:

1. Event validity and device authorization.
2. Exact request replay or cached response when available.
3. NUT-07 state checks for involved proofs.
4. NUT-09/NUT-13 restoration of outputs that may have been issued but not published.

The resolved branch is the one consistent with the mint's actual proof states and recoverable outputs. Invalid or losing events remain harmless historical evidence until compaction.

### 7.3 Candidate object granularity

Open question: objects may represent individual proofs or small proof bundles.

- Per-proof objects minimize conflict scope and resemble Cashu's bearer model.
- Bundles reduce event and storage overhead but create false conflicts when two operations use different proofs from the same bundle.

The current preference is per-proof identity inside encrypted payloads, with events allowed to batch several object transitions.

## 8. Event types

Exact Nostr kinds and wire encodings remain open. The logical event types are defined first.

Wallet clients create, serialize, sign, and encrypt these events locally. Relays and their databases only validate permitted outer-envelope properties and retain opaque ciphertext; they do not encode wallet state, decrypt payloads, or compute the current balance.

### 8.1 Device authorization

Authorizes a device pubkey and records its roles, epoch, creation time, and optional expiry.

### 8.2 Intent

Published before a potentially destructive mint operation. It reserves:

- input state object IDs;
- NUT-13 counters and blinded outputs;
- an `op_id`;
- a hash or canonical encoding of the exact mint request;
- expected operation type and mint endpoint.

An intent prevents another synchronized device from deliberately reusing the same local objects or counters. It also gives a recovering device enough information to replay or inspect an interrupted operation.

### 8.3 Commit

Records the result of an intent:

- consumed object IDs;
- newly created proofs or pending outputs;
- mint response hash;
- fees and change when relevant;
- final operation status.

### 8.4 Abort

Marks an intent as safely abandoned after the mint confirms that its inputs remain unspent or the exact request failed without side effects.

### 8.5 Checkpoint

Contains a complete encrypted projection of the current wallet state plus:

- the event frontier it covers;
- proof objects and statuses;
- pending intents;
- NUT-13 counters per keyset;
- device authorization state;
- protocol and encryption versions.

A checkpoint starts a new compaction epoch. Earlier events can expire after the checkpoint is widely available.

## 9. Operation protocol

### 9.1 Operation preflight

Every state-changing operation begins with:

```text
fetch events → validate → project state → query mint → reconcile
```

The device MUST NOT select proofs or counters before this preflight completes.

This preflight is in addition to automatic synchronization on application startup or foreground resume. A live subscription may reduce the number of new events fetched, but a client still validates that its retained checkpoint and frontier are current enough for the operation.

### 9.2 Mint

Proposed flow:

```text
1. Synchronize and reconcile current state.
2. Obtain or refresh the mint quote.
3. Reserve NUT-13 counters and build deterministic blinded outputs.
4. Persist the intent locally.
5. Publish the encrypted intent to the sync relay(s).
6. Execute the mint request against the Cashu mint.
7. Persist the response and new proofs locally.
8. Publish the encrypted commit.
9. On interruption, replay or reconcile the intent.
```

### 9.3 Melt

Proposed flow:

```text
1. Synchronize and reconcile current state.
2. Obtain or refresh the melt quote.
3. Select input proof objects and build the exact melt request.
4. Persist the intent locally.
5. Publish the encrypted intent to the sync relay(s).
6. Execute the melt request against the Cashu mint.
7. Persist the response and any change proofs before marking inputs spent.
8. Publish the encrypted commit.
9. On interruption, replay or reconcile the intent.
```

An implementation MAY execute either a mint or melt request if relay publication is temporarily unavailable, but MUST preserve the exact request and recovery material locally. This is a degraded mode whose crash-recovery behavior needs explicit tests.

### 9.4 Operation boundary

The product does not serialize proofs for transfer to another wallet and does not expose send, receive, or swap operations. Plaintext proofs leave a wallet client only in requests to the configured Cashu mint. Cashu Sync events sent to the relay contain encrypted accounting and recovery state.

## 10. Conflict and crash recovery

### 10.1 Localized conflict

If two events consume the same object, clients MUST NOT choose solely by timestamp or event arrival order. They inspect the associated intents and ask the mint for the actual proof states.

### 10.2 Crash after intent, before mint request

If all reserved inputs remain unspent and no cached response exists, the intent may be aborted or its exact request may be submitted.

### 10.3 Crash after mint accepts, before response persistence

Recover by replaying the exact request through NUT-19 when supported, or by reconstructing deterministic blinded messages and requesting signatures through NUT-09.

### 10.4 Crash after local response, before commit publication

The local device republishes the commit. If that device is lost, mnemonic recovery or another device completes the intent using its recorded counters, request, and mint state.

### 10.5 Stale spent proof

Remove it after NUT-07 reconciliation. This inconsistency MUST NOT block discovery of unrelated unspent proofs.

### 10.6 Missing unspent proof

Recovery attempts, in order:

1. Fetch all retained events and checkpoints.
2. Complete unresolved intents using NUT-19.
3. Restore deterministic outputs using NUT-09/NUT-13.
4. Scan further NUT-13 counter batches when the recorded high-water mark may be stale.

## 11. Recovery modes

### 11.1 Existing device resync

Use the latest locally trusted checkpoint, fetch later events, rebuild the projection, and reconcile proof states.

### 11.2 Pairing a new device

Inspired by NWC one-click connections:

1. The new device generates an ephemeral or permanent device key locally.
2. A QR/deeplink exchanges relay hints, public keys, protocol version, and a random challenge.
3. An existing authorized device approves the connection.
4. It sends an NIP-44 encrypted bundle containing the raw BIP39 seed, wallet group key, mint URL, current checkpoint/frontier, and device authorization.
5. The new device fetches and validates the event set before becoming operational.

### 11.3 Full master-seed recovery

The user imports the previously exported twelve-word BIP39 mnemonic into a replacement PWA or CLI wallet. The known service configuration determines the mint and sync endpoints. The mnemonic derives the BIP39 seed and Cashu Sync root.

Recovery:

1. Derive sync keys and fetch retained checkpoints/events.
2. Validate and project the recovered event set.
3. Complete pending intents.
4. Run NUT-13/NUT-09 recovery as a completeness backstop.
5. Check proof states through NUT-07.
6. Publish a fresh checkpoint and begin a new epoch if required.

If sync data expired, recovery falls back entirely to NUT-13/NUT-09 and loses nonessential history and metadata.

## 12. Expiration and garbage collection

The proposed storage policy is:

- Events expire six months after publication.
- Any successful wallet mutation refreshes recovery freshness.
- Active wallets publish a compacted checkpoint after at most four to five months.
- A checkpoint includes all unspent proofs and unresolved intents required for recovery.
- Events covered by a checkpoint may expire without breaking reconstruction.

NIP-40 expiration tags are advisory. A private relay MUST enforce its own retention policy and MUST NOT present expiration as secure deletion.

An inactive wallet may lose fast sync after six months. The mnemonic and mint restoration path remain the recovery backstop, subject to the mint's NUT-09 retention guarantee.

## 13. Integrity validation

For every event, a client MUST:

1. Validate the Nostr event ID and Schnorr signature.
2. Verify that the author is authorized for the event's epoch and role.
3. Decrypt and authenticate the NIP-44 payload.
4. Validate referenced input object IDs, intents, and causal parents.
5. Detect conflicting consumption of the same state object.
6. Compare recovered frontiers with locally remembered or independently replicated checkpoints when available.

No additional application MAC is required when NIP-44 is used correctly. NIP-44 authenticates the ciphertext, while the Nostr signature authenticates the outer event.

A valid historical checkpoint can still be a rollback. Detecting complete rollback requires a newer remembered frontier, an independent checkpoint, or comparison across relays.

## 14. Privacy model

### 14.1 Content privacy

Proofs and wallet metadata are E2E encrypted. Relays and the mint MUST NOT receive plaintext sync state.

### 14.2 Metadata limitations

NIP-44 does not hide:

- event author;
- timestamps;
- approximate size;
- relay access patterns;
- client IP from network intermediaries.

Dedicated device keys avoid linking wallet traffic to the user's social Nostr identity. They do not prevent a relay from linking all events by one device.

### 14.3 Decoupling from mint operations

Sync events SHOULD be published separately from Cashu HTTP requests. Implementations MAY add delay, batching, multiple relays, or separate network paths to reduce timing correlation.

A relay operated by the same mint improves availability and access control but gives one operator visibility into both mint and sync metadata. This is an explicit privacy tradeoff, not equivalent to metadata anonymity.

### 14.4 No proof-derived storage keys

Proof secrets become visible to the mint when spent. Sync encryption keys and locators MUST NOT be derived directly from proof secrets.

## 15. Capability requirements

The first deployment requires a selected mint and wallet implementation supporting:

- NUT-07 proof state checks.
- NUT-09 restore.
- NUT-13 deterministic wallet outputs.

Recommended:

- NUT-17 notifications.
- NUT-19 cached responses.

The mint MUST publish or document its NUT-09 retention guarantee. If NUT-09 data expires, recovery from mnemonic alone has the same retention limit after sync checkpoints expire.

## 16. Open questions

1. Exact KDF and test vectors for the Cashu Sync root and wallet group key.
2. Exact application-specific Nostr event kinds and relay query strategy.
3. Per-proof versus small-bundle state object granularity.
4. Whether intents must reach one relay before a mint request may proceed.
5. How NUT-13 counters are reserved across devices without large scan gaps.
6. Whether checkpoints use a single signed frontier, a vector of device frontiers, or a Merkle set commitment.
7. Device authorization and delegation semantics.
8. Whether the first relay is mint-operated, independent, or replicated across both.
9. Metadata-obfuscation targets and measurable acceptance criteria.
10. NUT-09 retention, storage cost, rate limits, and abuse prevention.
11. Whether transaction history is stored at all or reconstructed only while retained events exist.

## 17. Required fault-injection tests

An implementation is not recovery-safe until it has tests that crash at every boundary:

- before and after local intent persistence;
- before and after relay intent publication;
- before and after mint request submission;
- after mint acceptance but before response receipt;
- after response receipt but before local commit;
- before and after relay commit publication;
- while another device has stale state;
- after checkpoint publication but before old event expiry;
- after sync data expiry with mnemonic-only recovery.

The primary assertion is: every proof that remains unspent at the mint is eventually rediscovered by at least one supported recovery path.
