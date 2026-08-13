package relay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip42"

	"github.com/silentlink/cashu-sync/relay/internal/store"
)

func TestProtocolRejectsInvalidSignatureBeforeStorage(t *testing.T) {
	client, _, repository := protocolFixture(t)
	key := nostr.GeneratePrivateKey()
	event := testEvent(t, key, DefaultConfig(), "", "ciphertext")
	first := byte('0')
	if event.Sig[0] == first {
		first = '1'
	}
	event.Sig = string(first) + event.Sig[1:]

	writeEnvelope(t, client, &nostr.EventEnvelope{Event: event})
	response := readUntil[*nostr.OKEnvelope](t, client)
	if response.OK || !strings.HasPrefix(response.Reason, "invalid:") {
		t.Fatalf("invalid signature response: ok=%v reason=%q", response.OK, response.Reason)
	}
	if _, err := repository.Head(context.Background(), mustPublicKey(t, key), V0Identifier); err != store.ErrNotFound {
		t.Fatalf("invalid event was stored: %v", err)
	}
}

func TestProtocolRequiresAuthenticationForWritesAndReads(t *testing.T) {
	client, _, _ := protocolFixture(t)
	key := nostr.GeneratePrivateKey()
	event := testEvent(t, key, DefaultConfig(), "", "ciphertext")

	writeEnvelope(t, client, &nostr.EventEnvelope{Event: event})
	writeResponse := readUntil[*nostr.OKEnvelope](t, client)
	if writeResponse.OK || !strings.HasPrefix(writeResponse.Reason, "auth-required:") {
		t.Fatalf("unauthenticated write response: ok=%v reason=%q", writeResponse.OK, writeResponse.Reason)
	}

	writeEnvelope(t, client, &nostr.ReqEnvelope{
		SubscriptionID: "read",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
	})
	closed := readUntil[*nostr.ClosedEnvelope](t, client)
	if !strings.HasPrefix(closed.Reason, "auth-required:") {
		t.Fatalf("unauthenticated read reason = %q", closed.Reason)
	}
}

func TestProtocolAuthenticationIsolatesWallets(t *testing.T) {
	client, websocketURL, _ := protocolFixture(t)
	key := nostr.GeneratePrivateKey()
	other := nostr.GeneratePrivateKey()
	authenticate(t, client, websocketURL, key)

	writeEnvelope(t, client, &nostr.ReqEnvelope{
		SubscriptionID: "other-wallet",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, other))},
	})
	closed := readUntil[*nostr.ClosedEnvelope](t, client)
	if !strings.HasPrefix(closed.Reason, "restricted:") {
		t.Fatalf("cross-wallet read reason = %q", closed.Reason)
	}

	event := testEvent(t, key, DefaultConfig(), "", "ciphertext")
	writeEnvelope(t, client, &nostr.EventEnvelope{Event: event})
	ok := readUntil[*nostr.OKEnvelope](t, client)
	if !ok.OK {
		t.Fatalf("authenticated write rejected: %s", ok.Reason)
	}

	writeEnvelope(t, client, &nostr.ReqEnvelope{
		SubscriptionID: "own-wallet",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
	})
	stored := readUntil[*nostr.EventEnvelope](t, client)
	if stored.Event.ID != event.ID {
		t.Fatalf("read event = %s, want %s", stored.Event.ID, event.ID)
	}
}

func TestProtocolRejectsStaleChild(t *testing.T) {
	client, websocketURL, _ := protocolFixture(t)
	key := nostr.GeneratePrivateKey()
	authenticate(t, client, websocketURL, key)
	genesis := testEvent(t, key, DefaultConfig(), "", "genesis-ciphertext")
	publishOK(t, client, genesis)
	winner := testEvent(t, key, DefaultConfig(), genesis.ID, "winner-ciphertext")
	publishOK(t, client, winner)
	stale := testEvent(t, key, DefaultConfig(), genesis.ID, "stale-ciphertext")

	writeEnvelope(t, client, &nostr.EventEnvelope{Event: stale})
	response := readUntil[*nostr.OKEnvelope](t, client)
	if response.OK || !strings.HasPrefix(response.Reason, "conflict:") {
		t.Fatalf("stale child response: ok=%v reason=%q", response.OK, response.Reason)
	}

	writeEnvelope(t, client, &nostr.ReqEnvelope{
		SubscriptionID: "head-after-conflict",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
	})
	head := readUntil[*nostr.EventEnvelope](t, client)
	if head.Event.ID != winner.ID {
		t.Fatalf("head after conflict = %s, want %s", head.Event.ID, winner.ID)
	}
}

func TestProtocolDuplicatePublishIsIdempotentSuccess(t *testing.T) {
	client, websocketURL, _ := protocolFixture(t)
	key := nostr.GeneratePrivateKey()
	authenticate(t, client, websocketURL, key)
	event := testEvent(t, key, DefaultConfig(), "", "ciphertext")
	publishOK(t, client, event)

	writeEnvelope(t, client, &nostr.EventEnvelope{Event: event})
	response := readUntil[*nostr.OKEnvelope](t, client)
	if !response.OK || response.EventID != event.ID {
		t.Fatalf("duplicate response: ok=%v event=%s reason=%q", response.OK, response.EventID, response.Reason)
	}
}

func TestAllowlistRejectsRotatedUnadmittedKeysWithoutStateOrLimiterGrowth(t *testing.T) {
	allowedKey := nostr.GeneratePrivateKey()
	config := allowlistConfig(t, allowedKey)
	websocketURL, repository, server := protocolServer(t, config)
	for i := 0; i < 24; i++ {
		key := nostr.GeneratePrivateKey()
		client := dialProtocol(t, websocketURL, nil)
		authenticate(t, client, "wss://sync.example.com", key)
		event := testEvent(t, key, config, "", "ciphertext")
		writeEnvelope(t, client, &nostr.EventEnvelope{Event: event})
		response := readUntil[*nostr.OKEnvelope](t, client)
		if response.OK || !strings.HasPrefix(response.Reason, "restricted:") {
			t.Fatalf("unadmitted write %d: ok=%v reason=%q", i, response.OK, response.Reason)
		}
		writeEnvelope(t, client, &nostr.ReqEnvelope{
			SubscriptionID: "unadmitted-read",
			Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
		})
		closed := readUntil[*nostr.ClosedEnvelope](t, client)
		if !strings.HasPrefix(closed.Reason, "restricted:") {
			t.Fatalf("unadmitted read %d reason=%q", i, closed.Reason)
		}
		if _, err := repository.Head(context.Background(), mustPublicKey(t, key), V0Identifier); err != store.ErrNotFound {
			t.Fatalf("unadmitted key %d created state: %v", i, err)
		}
		_ = client.Close()
	}
	writeKeys, readKeys := server.policy.limiterSizes()
	if writeKeys != 0 || readKeys != 0 {
		t.Fatalf("unadmitted keys grew limiters: writes=%d reads=%d", writeKeys, readKeys)
	}
}

func TestPairedClientsShareOneAllowlistedSyncKey(t *testing.T) {
	key := nostr.GeneratePrivateKey()
	config := allowlistConfig(t, key)
	websocketURL, _, _ := protocolServer(t, config)
	clientA := dialProtocol(t, websocketURL, nil)
	clientB := dialProtocol(t, websocketURL, nil)
	authenticate(t, clientA, "wss://sync.example.com", key)
	authenticate(t, clientB, "wss://sync.example.com", key)

	event := testEvent(t, key, config, "", "ciphertext")
	publishOK(t, clientA, event)
	writeEnvelope(t, clientB, &nostr.ReqEnvelope{
		SubscriptionID: "paired-read",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
	})
	stored := readUntil[*nostr.EventEnvelope](t, clientB)
	if stored.Event.ID != event.ID {
		t.Fatalf("paired client read event %s, want %s", stored.Event.ID, event.ID)
	}
}

func TestWriteRateLimitFollowsPubkeyAcrossIPChanges(t *testing.T) {
	key := nostr.GeneratePrivateKey()
	config := allowlistConfig(t, key)
	config.WritesPerMinute = 1
	websocketURL, _, _ := protocolServer(t, config)
	clientA := dialProtocol(t, websocketURL, http.Header{"X-Forwarded-For": {"198.51.100.10"}})
	clientB := dialProtocol(t, websocketURL, http.Header{"X-Forwarded-For": {"203.0.113.20"}})
	authenticate(t, clientA, "wss://sync.example.com", key)
	authenticate(t, clientB, "wss://sync.example.com", key)
	genesis := testEvent(t, key, config, "", "genesis")
	publishOK(t, clientA, genesis)
	child := testEvent(t, key, config, genesis.ID, "child")
	writeEnvelope(t, clientB, &nostr.EventEnvelope{Event: child})
	response := readUntil[*nostr.OKEnvelope](t, clientB)
	if response.OK || !strings.HasPrefix(response.Reason, "rate-limited:") {
		t.Fatalf("second IP bypassed pubkey rate limit: ok=%v reason=%q", response.OK, response.Reason)
	}
}

func TestCanonicalServiceURLIgnoresForwardedHostSpoofing(t *testing.T) {
	key := nostr.GeneratePrivateKey()
	config := allowlistConfig(t, key)
	websocketURL, _, server := protocolServer(t, config)
	if server.Relay.ServiceURL != "https://sync.example.com" {
		t.Fatalf("Khatru service URL = %q", server.Relay.ServiceURL)
	}
	headers := http.Header{
		"X-Forwarded-Host":  {"attacker.example"},
		"X-Forwarded-Proto": {"http"},
	}
	client := dialProtocol(t, websocketURL, headers)
	authenticate(t, client, "wss://sync.example.com", key)

	spoofed := dialProtocol(t, websocketURL, headers)
	writeEnvelope(t, spoofed, &nostr.ReqEnvelope{
		SubscriptionID: "auth-prompt",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
	})
	challenge := readUntil[*nostr.AuthEnvelope](t, spoofed)
	authEvent := nip42.CreateUnsignedAuthEvent(*challenge.Challenge, mustPublicKey(t, key), "ws://attacker.example")
	if err := authEvent.Sign(key); err != nil {
		t.Fatalf("sign spoofed auth: %v", err)
	}
	writeEnvelope(t, spoofed, &nostr.AuthEnvelope{Event: authEvent})
	response := readUntil[*nostr.OKEnvelope](t, spoofed)
	if response.OK {
		t.Fatal("forwarded host spoof changed the accepted NIP-42 relay URL")
	}
}

func TestHealthzReflectsRepositoryReadiness(t *testing.T) {
	repository, err := store.Open(filepath.Join(t.TempDir(), "relay.db"), 8)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	server := New(repository, DefaultConfig())
	httpServer := httptest.NewServer(server.Relay)
	t.Cleanup(httpServer.Close)

	response, err := http.Get(httpServer.URL + "/healthz")
	if err != nil {
		t.Fatalf("get health: %v", err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK || string(body) != "ok\n" {
		t.Fatalf("healthy response: status=%d body=%q", response.StatusCode, body)
	}

	if err := repository.Close(); err != nil {
		t.Fatalf("close repository: %v", err)
	}
	response, err = http.Get(httpServer.URL + "/healthz")
	if err != nil {
		t.Fatalf("get unhealthy health: %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("unhealthy status = %d, want %d", response.StatusCode, http.StatusServiceUnavailable)
	}
}

func protocolFixture(t *testing.T) (*websocket.Conn, string, *store.Repository) {
	t.Helper()
	websocketURL, repository, _ := protocolServer(t, DefaultConfig())
	client := dialProtocol(t, websocketURL, nil)
	return client, websocketURL, repository
}

func protocolServer(t *testing.T, config Config) (string, *store.Repository, *Server) {
	t.Helper()
	repository, err := store.Open(filepath.Join(t.TempDir(), "relay.db"), 8)
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	t.Cleanup(func() { _ = repository.Close() })
	server := New(repository, config)
	httpServer := httptest.NewServer(server.Relay)
	t.Cleanup(httpServer.Close)
	websocketURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	return websocketURL, repository, server
}

func dialProtocol(t *testing.T, websocketURL string, headers http.Header) *websocket.Conn {
	t.Helper()
	client, _, err := websocket.DefaultDialer.Dial(websocketURL, headers)
	if err != nil {
		t.Fatalf("dial relay: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func allowlistConfig(t *testing.T, keys ...string) Config {
	t.Helper()
	config := DefaultConfig()
	config.AdmissionMode = AdmissionAllowlist
	config.ServiceURL = "https://sync.example.com"
	config.AllowedPubkeys = make(map[string]struct{}, len(keys))
	for _, key := range keys {
		config.AllowedPubkeys[mustPublicKey(t, key)] = struct{}{}
	}
	return config
}

func authenticate(t *testing.T, client *websocket.Conn, websocketURL string, key string) {
	t.Helper()
	writeEnvelope(t, client, &nostr.ReqEnvelope{
		SubscriptionID: "auth-prompt",
		Filters:        []nostr.Filter{walletFilter(mustPublicKey(t, key))},
	})
	challenge := readUntil[*nostr.AuthEnvelope](t, client)
	if challenge.Challenge == nil {
		t.Fatal("relay did not provide an auth challenge")
	}
	authEvent := nip42.CreateUnsignedAuthEvent(*challenge.Challenge, mustPublicKey(t, key), websocketURL)
	if err := authEvent.Sign(key); err != nil {
		t.Fatalf("sign auth event: %v", err)
	}
	writeEnvelope(t, client, &nostr.AuthEnvelope{Event: authEvent})
	response := readUntil[*nostr.OKEnvelope](t, client)
	if !response.OK || response.EventID != authEvent.ID {
		t.Fatalf("authentication failed: ok=%v reason=%q", response.OK, response.Reason)
	}
}

func walletFilter(pubkey string) nostr.Filter {
	return nostr.Filter{
		Authors: []string{pubkey},
		Kinds:   []int{V0Kind},
		Tags:    nostr.TagMap{"d": {V0Identifier}},
		Limit:   1,
	}
}

func publishOK(t *testing.T, client *websocket.Conn, event nostr.Event) {
	t.Helper()
	writeEnvelope(t, client, &nostr.EventEnvelope{Event: event})
	response := readUntil[*nostr.OKEnvelope](t, client)
	if !response.OK {
		t.Fatalf("publish %s failed: %s", event.ID, response.Reason)
	}
}

func writeEnvelope(t *testing.T, client *websocket.Conn, envelope nostr.Envelope) {
	t.Helper()
	payload, err := envelope.MarshalJSON()
	if err != nil {
		t.Fatalf("marshal %s envelope: %v", envelope.Label(), err)
	}
	if err := client.WriteMessage(websocket.TextMessage, payload); err != nil {
		t.Fatalf("write %s envelope: %v", envelope.Label(), err)
	}
}

func readUntil[T nostr.Envelope](t *testing.T, client *websocket.Conn) T {
	t.Helper()
	if err := client.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for {
		_, data, err := client.ReadMessage()
		if err != nil {
			t.Fatalf("read relay response: %v", err)
		}
		envelope := nostr.ParseMessage(string(data))
		if envelope == nil {
			t.Fatalf("parse relay response %s", data)
		}
		if wanted, ok := envelope.(T); ok {
			return wanted
		}
	}
}
