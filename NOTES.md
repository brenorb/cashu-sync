# Teaching and design notes

- Pairing UX decision: when Alice and Carol are physically co-present, pairing should complete automatically after the one QR scan; no manual approval step. Keep challenge binding, short expiry, one-time keys, encrypted authority response, and immediate ephemeral-key cleanup.
- Nostr DM is pairing transport, not the trust boundary. Do not reuse the long-lived sync key or Cashu seed-derived social Nostr identity for the pairing session.
