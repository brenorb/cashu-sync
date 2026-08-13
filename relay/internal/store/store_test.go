package store

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const testIdentifier = "com.silentlink.cashu-sync.wallet.v0"

func TestAdvanceGenesisAndChild(t *testing.T) {
	repo := openTestRepository(t, filepath.Join(t.TempDir(), "relay.db"))
	key := nostr.GeneratePrivateKey()
	genesis := signedEvent(t, key, "", "genesis")

	result, err := repo.Advance(context.Background(), genesis)
	if err != nil {
		t.Fatalf("advance genesis: %v", err)
	}
	if result.Duplicate {
		t.Fatal("genesis was reported as a duplicate")
	}

	child := signedEvent(t, key, genesis.ID, "child")
	if _, err := repo.Advance(context.Background(), child); err != nil {
		t.Fatalf("advance child: %v", err)
	}

	head, err := repo.Head(context.Background(), publicKey(t, key), testIdentifier)
	if err != nil {
		t.Fatalf("read head: %v", err)
	}
	if head.ID != child.ID {
		t.Fatalf("head = %s, want %s", head.ID, child.ID)
	}
}

func TestAdvanceRejectsStaleChild(t *testing.T) {
	repo := openTestRepository(t, filepath.Join(t.TempDir(), "relay.db"))
	key := nostr.GeneratePrivateKey()
	genesis := signedEvent(t, key, "", "genesis")
	mustAdvance(t, repo, genesis)
	winner := signedEvent(t, key, genesis.ID, "winner")
	mustAdvance(t, repo, winner)
	stale := signedEvent(t, key, genesis.ID, "stale")

	_, err := repo.Advance(context.Background(), stale)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("advance stale child error = %v, want ErrConflict", err)
	}

	head, err := repo.Head(context.Background(), publicKey(t, key), testIdentifier)
	if err != nil {
		t.Fatalf("read head: %v", err)
	}
	if head.ID != winner.ID {
		t.Fatalf("stale child changed head to %s", head.ID)
	}
}

func TestAdvanceDuplicateIsIdempotent(t *testing.T) {
	repo := openTestRepository(t, filepath.Join(t.TempDir(), "relay.db"))
	event := signedEvent(t, nostr.GeneratePrivateKey(), "", "genesis")
	mustAdvance(t, repo, event)

	result, err := repo.Advance(context.Background(), event)
	if err != nil {
		t.Fatalf("advance duplicate: %v", err)
	}
	if !result.Duplicate {
		t.Fatal("duplicate was not reported as idempotent")
	}
}

func TestConcurrentChildrenHaveExactlyOneWinner(t *testing.T) {
	repo := openTestRepository(t, filepath.Join(t.TempDir(), "relay.db"))
	key := nostr.GeneratePrivateKey()
	genesis := signedEvent(t, key, "", "genesis")
	mustAdvance(t, repo, genesis)
	children := []nostr.Event{
		signedEvent(t, key, genesis.ID, "child-a"),
		signedEvent(t, key, genesis.ID, "child-b"),
	}

	start := make(chan struct{})
	errs := make(chan error, len(children))
	var wg sync.WaitGroup
	for _, event := range children {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := repo.Advance(context.Background(), event)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	var successes, conflicts int
	for err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent error: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d, want 1 and 1", successes, conflicts)
	}
}

func TestHeadSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.db")
	key := nostr.GeneratePrivateKey()
	event := signedEvent(t, key, "", "genesis")

	repo := openTestRepository(t, path)
	mustAdvance(t, repo, event)
	if err := repo.Close(); err != nil {
		t.Fatalf("close repository: %v", err)
	}

	reopened, err := Open(path, 8)
	if err != nil {
		t.Fatalf("reopen repository: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	head, err := reopened.Head(context.Background(), publicKey(t, key), testIdentifier)
	if err != nil {
		t.Fatalf("read head after restart: %v", err)
	}
	if head.ID != event.ID {
		t.Fatalf("head after restart = %s, want %s", head.ID, event.ID)
	}
}

func TestHistoryPruningRetainsLatestEventsAndIsolatesAuthors(t *testing.T) {
	repo, err := Open(filepath.Join(t.TempDir(), "relay.db"), 2)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	ctx := context.Background()
	keyA := nostr.GeneratePrivateKey()
	keyB := nostr.GeneratePrivateKey()
	a1 := signedEvent(t, keyA, "", "a1")
	a2 := signedEvent(t, keyA, a1.ID, "a2")
	a3 := signedEvent(t, keyA, a2.ID, "a3")
	b1 := signedEvent(t, keyB, "", "b1")
	for _, event := range []nostr.Event{a1, a2, b1, a3} {
		mustAdvance(t, repo, event)
	}

	aEvents := collectEvents(repo.Query(ctx, nostr.Filter{
		Authors: []string{publicKey(t, keyA)},
		Kinds:   []int{30078},
		Tags:    nostr.TagMap{"d": {testIdentifier}},
	}))
	if len(aEvents) != 2 || aEvents[0].ID != a3.ID || aEvents[1].ID != a2.ID {
		t.Fatalf("author A history = %v, want latest [a3 a2]", eventIDs(aEvents))
	}
	aHead, err := repo.Head(ctx, publicKey(t, keyA), testIdentifier)
	if err != nil || aHead.ID != a3.ID {
		t.Fatalf("author A head = %s, %v; want a3", aHead.ID, err)
	}

	bEvents := collectEvents(repo.Query(ctx, nostr.Filter{
		Authors: []string{publicKey(t, keyB)},
		Kinds:   []int{30078},
		Tags:    nostr.TagMap{"d": {testIdentifier}},
	}))
	if len(bEvents) != 1 || bEvents[0].ID != b1.ID {
		t.Fatalf("author B history = %v, want [b1]", eventIDs(bEvents))
	}
	bHead, err := repo.Head(ctx, publicKey(t, keyB), testIdentifier)
	if err != nil || bHead.ID != b1.ID {
		t.Fatalf("author B head = %s, %v; want b1", bHead.ID, err)
	}
}

func openTestRepository(t *testing.T, path string) *Repository {
	t.Helper()
	repo, err := Open(path, 8)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	return repo
}

func signedEvent(t *testing.T, key string, previous, content string) nostr.Event {
	t.Helper()
	event := nostr.Event{
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Kind:      30078,
		Tags: nostr.Tags{
			{"d", testIdentifier},
			{"prev", previous},
			{"schema", "0"},
		},
		Content: content,
	}
	if err := event.Sign(key); err != nil {
		t.Fatalf("sign event: %v", err)
	}
	return event
}

func publicKey(t *testing.T, secretKey string) string {
	t.Helper()
	publicKey, err := nostr.GetPublicKey(secretKey)
	if err != nil {
		t.Fatalf("derive public key: %v", err)
	}
	return publicKey
}

func mustAdvance(t *testing.T, repo *Repository, event nostr.Event) {
	t.Helper()
	if _, err := repo.Advance(context.Background(), event); err != nil {
		t.Fatalf("advance event: %v", err)
	}
}

func collectEvents(events func(func(nostr.Event) bool)) []nostr.Event {
	collected := make([]nostr.Event, 0)
	for event := range events {
		collected = append(collected, event)
	}
	return collected
}

func eventIDs(events []nostr.Event) []string {
	ids := make([]string, len(events))
	for i, event := range events {
		ids[i] = event.ID
	}
	return ids
}
