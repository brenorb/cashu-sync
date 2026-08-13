package relay

import (
	"context"
	"errors"
	"net/http"

	"github.com/fiatjaf/eventstore"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"

	"github.com/silentlink/cashu-sync/relay/internal/store"
)

type Server struct {
	Relay  *khatru.Relay
	policy *Policy
}

func New(repository *store.Repository, config Config) *Server {
	policy := NewPolicy(config)
	relay := khatru.NewRelay()
	relay.Info.Name = "Silent Link Cashu Sync"
	relay.Info.Description = "Private encrypted snapshot relay for Cashu Sync v0"
	relay.Info.SupportedNIPs = []any{1, 11, 42, 78}
	relay.MaxMessageSize = int64(config.MaxContentBytes + 16*1024)
	if config.AdmissionMode == AdmissionAllowlist {
		relay.ServiceURL = config.ServiceURL
	}
	relay.Router().HandleFunc("GET /healthz", func(writer http.ResponseWriter, request *http.Request) {
		if err := repository.Ping(request.Context()); err != nil {
			http.Error(writer, "not ready", http.StatusServiceUnavailable)
			return
		}
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = writer.Write([]byte("ok\n"))
	})
	relay.RejectEvent = append(relay.RejectEvent, policy.OnEvent)
	relay.RejectFilter = append(relay.RejectFilter, policy.OnRequest)
	relay.ReplaceEvent = append(relay.ReplaceEvent, func(ctx context.Context, event *nostr.Event) error {
		result, err := repository.Advance(ctx, *event)
		if err != nil {
			if errors.Is(err, store.ErrConflict) {
				return errors.New("conflict: stale previous event")
			}
			return err
		}
		if result.Duplicate {
			return eventstore.ErrDupEvent
		}
		return nil
	})
	relay.QueryEvents = append(relay.QueryEvents, func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
		result := make(chan *nostr.Event)
		go func() {
			defer close(result)
			for event := range repository.Query(ctx, filter) {
				event := event
				select {
				case result <- &event:
				case <-ctx.Done():
					return
				}
			}
		}()
		return result, nil
	})
	return &Server{Relay: relay, policy: policy}
}
