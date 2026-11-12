
it("audit: two devices can POST the same published prepared request", async () => {
  const a = fixture();
  const b = fixture();
  let remote = snapshot();
  for (const device of [a, b]) {
    device.sync.pull.mockImplementation(async () => {
      device.journal.state = structuredClone(remote);
      return { status: "applied", eventId: remote.previous_event_id,
        revision: remote.revision, mode: "child" };
    });
    device.sync.publishCurrent.mockImplementation(async () => {
      const local = device.journal.state;
      expect(local.previous_event_id).toBe(remote.previous_event_id);
      expect(local.pending_operation?.phase).toBe("prepared");
      remote = { ...structuredClone(local), revision: local.revision + 1,
        previous_event_id: (device === a ? "b" : "d").repeat(64) };
      device.journal.state = structuredClone(remote);
      return { status: "accepted", resolution: "direct",
        eventId: remote.previous_event_id, revision: remote.revision };
    });
    // The test ends at the POST boundary; both simulated replies are lost.
    device.gateway.submitMint.mockRejectedValue(new Error("reply lost"));
  }
  a.gateway.submitMint.mockImplementationOnce(async () => {
    await b.coordinator.resume();
    throw new Error("reply lost");
  });
  const originalMark = a.journal.markSubmitted.getMockImplementation()!;
  a.journal.markSubmitted.mockImplementationOnce(async (...args) => {
    expect(remote.pending_operation?.phase).toBe("prepared");
    await b.sync.pull();
    await originalMark(...args);
  });
  await a.coordinator.mint("intent");
  expect(a.gateway.submitMint).toHaveBeenCalledExactlyOnceWith(mintPreview);
  expect(b.gateway.submitMint).toHaveBeenCalledExactlyOnceWith(mintPreview);
});

it("audit: UNPAID melt still returns the completed status", async () => {
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
