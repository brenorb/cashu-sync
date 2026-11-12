

it.each(["mint", "melt"] as const)(
  "audit: a peer resumes the submitted %s without making another initial request",
  async (kind) => {
    const a = fixture();
    const b = fixture();
    let remote = snapshot();
    a.sync.publishCandidate.mockImplementationOnce(async (candidate) => {
      expect(candidate.previous_event_id).toBe(remote.previous_event_id);
      expect(candidate.pending_operation?.phase).toBe("submitted");
      remote = { ...structuredClone(candidate), previous_event_id: PREPARED_HEAD };
      return { status: "accepted", resolution: "direct",
        eventId: remote.previous_event_id, revision: remote.revision };
    });
    b.sync.pull.mockImplementation(async () => {
      b.journal.state = structuredClone(remote);
      return { status: "applied", eventId: remote.previous_event_id,
        revision: remote.revision, mode: "child" };
    });
    const accept = a.journal.acceptSubmission.getMockImplementation()!;
    a.journal.acceptSubmission.mockImplementationOnce(async (...args) => {
      await expect(b.coordinator.resume()).resolves.toMatchObject({
        status: "needs-reconciliation", stage: "gateway-reconcile",
      });
      await accept(...args);
    });
    const submitA = kind === "mint" ? a.gateway.submitMint : a.gateway.submitMelt;
    submitA.mockRejectedValueOnce(new Error("reply lost"));

    await a.coordinator[kind]("intent");
    expect(submitA).toHaveBeenCalledOnce();
    expect(b.gateway.submitMint).not.toHaveBeenCalled();
    expect(b.gateway.submitMelt).not.toHaveBeenCalled();
    expect(b.sync.publishCandidate).not.toHaveBeenCalled();
  }
);

it("audit: two wallets with a legacy prepared head can only claim it once", async () => {
  const a = fixture();
  const b = fixture();
  a.journal.state = snapshot(pendingMint("prepared"));
  b.journal.state = structuredClone(a.journal.state);
  let head = HEAD;
  for (const device of [a, b]) {
    device.sync.publishCandidate.mockImplementation(async (candidate) => {
      if (candidate.previous_event_id !== head) {
        return { status: "conflict", currentEventId: head, currentRevision: 5 };
      }
      expect(candidate.pending_operation?.phase).toBe("submitted");
      head = PREPARED_HEAD;
      return { status: "accepted", resolution: "direct", eventId: head, revision: 5 };
    });
    device.gateway.submitMint.mockRejectedValueOnce(new Error("reply lost"));
  }

  const results = await Promise.all([a.coordinator.resume(), b.coordinator.resume()]);
  expect(results.map((result) => result.status).sort()).toEqual([
    "aborted-before-submit", "needs-reconciliation",
  ]);
  expect(a.gateway.submitMint.mock.calls.length + b.gateway.submitMint.mock.calls.length).toBe(1);
});

it("audit: an UNPAID terminal response can clear the journal", async () => {
  const value = fixture();
  value.gateway.submitMelt.mockResolvedValue({
    state: "UNPAID", payment_preimage: null, change: [],
  });
  await expect(value.coordinator.melt("intent")).resolves.toMatchObject({
    status: "completed", quoteId: "melt-q",
  });
  expect(value.journal.recordMeltResponse.mock.calls[0][1].state).toBe("UNPAID");
  expect(value.journal.finalizeAcceptedSnapshot).toHaveBeenCalledOnce();
});
