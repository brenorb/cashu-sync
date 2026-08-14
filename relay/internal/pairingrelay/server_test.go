package pairingrelay

import (
	"context"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

func TestMemoryStoreFiltersAndPrunesGiftWraps(t *testing.T) {
	store := &memoryStore{maxAge: time.Second}
	first := nostr.Event{ID: "first", Kind: GiftWrapKind, CreatedAt: nostr.Timestamp(time.Now().Unix()), Tags: nostr.Tags{{"p", "receiver"}}}
	if err := store.save(context.Background(), &first); err != nil {
		t.Fatal(err)
	}
	channel, err := store.query(context.Background(), nostr.Filter{Kinds: []int{GiftWrapKind}, Tags: nostr.TagMap{"p": []string{"receiver"}}})
	if err != nil {
		t.Fatal(err)
	}
	if event := <-channel; event == nil || event.ID != "first" {
		t.Fatalf("query returned %#v", event)
	}
	if _, open := <-channel; open {
		t.Fatal("query channel should close")
	}

	store.mu.Lock()
	store.events[0].createdAt = time.Now().Add(-2 * time.Second)
	store.mu.Unlock()
	channel, err = store.query(context.Background(), nostr.Filter{Kinds: []int{GiftWrapKind}})
	if err != nil {
		t.Fatal(err)
	}
	if event := <-channel; event != nil {
		t.Fatalf("expired event returned: %#v", event)
	}
}
