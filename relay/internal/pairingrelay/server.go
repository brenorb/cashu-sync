package pairingrelay

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/fiatjaf/eventstore"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

const GiftWrapKind = 1059

type Config struct {
	MaxAge time.Duration
}

type Server struct {
	Relay *khatru.Relay
	store *memoryStore
}

func New(config Config) *Server {
	if config.MaxAge <= 0 {
		config.MaxAge = 5 * time.Minute
	}
	store := &memoryStore{maxAge: config.MaxAge}
	relay := khatru.NewRelay()
	relay.Info.Name = "Silent Link pairing relay"
	relay.Info.Description = "Short-lived one-scan wallet pairing messages"
	relay.Info.SupportedNIPs = []any{1, 11, 17, 44, 59}
	relay.MaxMessageSize = 128 * 1024
	relay.RejectEvent = append(relay.RejectEvent, func(_ context.Context, event *nostr.Event) (bool, string) {
		if event.Kind != GiftWrapKind {
			return true, "restricted: pairing relay accepts gift wraps only"
		}
		return false, ""
	})
	relay.RejectFilter = append(relay.RejectFilter, func(_ context.Context, filter nostr.Filter) (bool, string) {
		for _, kind := range filter.Kinds {
			if kind != GiftWrapKind {
				return true, "restricted: pairing relay accepts gift wraps only"
			}
		}
		return false, ""
	})
	relay.StoreEvent = append(relay.StoreEvent, store.save)
	relay.QueryEvents = append(relay.QueryEvents, store.query)
	relay.Router().HandleFunc("GET /healthz", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = writer.Write([]byte("ok\n"))
	})
	return &Server{Relay: relay, store: store}
}

type storedEvent struct {
	event     nostr.Event
	createdAt time.Time
}

type memoryStore struct {
	mu     sync.Mutex
	maxAge time.Duration
	events []storedEvent
}

func (s *memoryStore) prune(now time.Time) {
	cutoff := now.Add(-s.maxAge)
	kept := s.events[:0]
	for _, item := range s.events {
		if item.createdAt.After(cutoff) {
			kept = append(kept, item)
		}
	}
	s.events = kept
}

func (s *memoryStore) save(_ context.Context, event *nostr.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.prune(now)
	for _, item := range s.events {
		if item.event.ID == event.ID {
			return eventstore.ErrDupEvent
		}
	}
	s.events = append(s.events, storedEvent{event: *event, createdAt: now})
	return nil
}

func (s *memoryStore) query(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	result := make(chan *nostr.Event)
	s.mu.Lock()
	s.prune(time.Now())
	items := append([]storedEvent(nil), s.events...)
	s.mu.Unlock()
	go func() {
		defer close(result)
		for index := len(items) - 1; index >= 0; index-- {
			if !filter.Matches(&items[index].event) {
				continue
			}
			copy := items[index].event
			select {
			case result <- &copy:
			case <-ctx.Done():
				return
			}
		}
	}()
	return result, nil
}
