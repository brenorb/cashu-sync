package relay

import (
	"strings"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

func TestValidateEvent(t *testing.T) {
	config := DefaultConfig()
	config.Now = func() time.Time { return time.Unix(1_780_000_000, 0) }
	key := nostr.GeneratePrivateKey()
	valid := testEvent(t, key, config, "", "ciphertext")

	tests := []struct {
		name   string
		mutate func(*nostr.Event)
	}{
		{"wrong kind", func(e *nostr.Event) { e.Kind = 1; resign(t, e, key) }},
		{"wrong d", func(e *nostr.Event) { e.Tags[0][1] = "another-app"; resign(t, e, key) }},
		{"wrong schema", func(e *nostr.Event) { e.Tags[2][1] = "1"; resign(t, e, key) }},
		{"missing prev", func(e *nostr.Event) { e.Tags = append(e.Tags[:1], e.Tags[2:]...); resign(t, e, key) }},
		{"duplicate d", func(e *nostr.Event) { e.Tags = append(e.Tags, nostr.Tag{"d", config.Identifier}); resign(t, e, key) }},
		{"extra public tag", func(e *nostr.Event) { e.Tags = append(e.Tags, nostr.Tag{"amount", "10"}); resign(t, e, key) }},
		{"malformed prev", func(e *nostr.Event) { e.Tags[1][1] = "not-an-event-id"; resign(t, e, key) }},
		{"oversized content", func(e *nostr.Event) {
			e.Content = strings.Repeat("x", config.MaxContentBytes+1)
			resign(t, e, key)
		}},
		{"too old", func(e *nostr.Event) {
			e.CreatedAt = nostr.Timestamp(config.Now().Add(-config.MaxClockSkew - time.Second).Unix())
			resign(t, e, key)
		}},
		{"too far in future", func(e *nostr.Event) {
			e.CreatedAt = nostr.Timestamp(config.Now().Add(config.MaxClockSkew + time.Second).Unix())
			resign(t, e, key)
		}},
		{"invalid signature", func(e *nostr.Event) { e.Sig = "0" + e.Sig[1:] }},
	}

	policy := NewPolicy(config)
	if err := policy.ValidateEvent(&valid); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event := valid
			event.Tags = make(nostr.Tags, len(valid.Tags))
			for i := range valid.Tags {
				event.Tags[i] = append(nostr.Tag(nil), valid.Tags[i]...)
			}
			tt.mutate(&event)
			if err := policy.ValidateEvent(&event); err == nil {
				t.Fatal("invalid event accepted")
			}
		})
	}
}

func TestValidateFilterRequiresOneAuthorAndV0Scope(t *testing.T) {
	config := DefaultConfig()
	key := nostr.GeneratePrivateKey()
	other := nostr.GeneratePrivateKey()
	pubkey := mustPublicKey(t, key)
	policy := NewPolicy(config)
	valid := nostr.Filter{
		Authors: []string{pubkey},
		Kinds:   []int{config.Kind},
		Tags:    nostr.TagMap{"d": {config.Identifier}},
		Limit:   1,
	}
	wrongAuthor := valid.Clone()
	wrongAuthor.Authors = []string{mustPublicKey(t, other)}
	if err := policy.ValidateFilter(pubkey, wrongAuthor); err == nil {
		t.Fatal("cross-wallet filter accepted")
	}

	wrongKind := valid.Clone()
	wrongKind.Kinds = []int{1}
	if err := policy.ValidateFilter(pubkey, wrongKind); err == nil {
		t.Fatal("wrong-kind read accepted")
	}

	if err := policy.ValidateFilter(pubkey, valid); err != nil {
		t.Fatalf("valid filter rejected: %s", err)
	}
}

func testEvent(t *testing.T, key string, config Config, previous, content string) nostr.Event {
	t.Helper()
	event := nostr.Event{
		CreatedAt: nostr.Timestamp(config.Now().Unix()),
		Kind:      config.Kind,
		Tags: nostr.Tags{
			{"d", config.Identifier},
			{"prev", previous},
			{"schema", config.Schema},
		},
		Content: content,
	}
	resign(t, &event, key)
	return event
}

func resign(t *testing.T, event *nostr.Event, key string) {
	t.Helper()
	if err := event.Sign(key); err != nil {
		t.Fatalf("sign event: %v", err)
	}
}

func mustPublicKey(t *testing.T, secretKey string) string {
	t.Helper()
	publicKey, err := nostr.GetPublicKey(secretKey)
	if err != nil {
		t.Fatalf("derive public key: %v", err)
	}
	return publicKey
}
