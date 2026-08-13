package relay

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

const (
	V0Kind       = 30078
	V0Identifier = "com.silentlink.cashu-sync.wallet.v0"
	V0Schema     = "0"
)

var lowercaseEventID = regexp.MustCompile(`^[0-9a-f]{64}$`)

type AdmissionMode string

const (
	AdmissionOpen      AdmissionMode = "open"
	AdmissionAllowlist AdmissionMode = "allowlist"
)

type Config struct {
	Kind              int
	Identifier        string
	Schema            string
	MaxContentBytes   int
	MaxClockSkew      time.Duration
	WritesPerMinute   int
	RequestsPerMinute int
	Now               func() time.Time
	AdmissionMode     AdmissionMode
	AllowedPubkeys    map[string]struct{}
	ServiceURL        string
}

func DefaultConfig() Config {
	return Config{
		Kind:              V0Kind,
		Identifier:        V0Identifier,
		Schema:            V0Schema,
		MaxContentBytes:   256 * 1024,
		MaxClockSkew:      10 * time.Minute,
		WritesPerMinute:   60,
		RequestsPerMinute: 120,
		Now:               time.Now,
		AdmissionMode:     AdmissionOpen,
	}
}

type Policy struct {
	config Config
	writes *fixedWindowLimiter
	reads  *fixedWindowLimiter
}

func NewPolicy(config Config) *Policy {
	allowed := make(map[string]struct{}, len(config.AllowedPubkeys))
	for pubkey := range config.AllowedPubkeys {
		allowed[pubkey] = struct{}{}
	}
	config.AllowedPubkeys = allowed
	return &Policy{
		config: config,
		writes: newFixedWindowLimiter(config.WritesPerMinute, time.Minute, config.Now),
		reads:  newFixedWindowLimiter(config.RequestsPerMinute, time.Minute, config.Now),
	}
}

func (p *Policy) OnEvent(ctx context.Context, event *nostr.Event) (bool, string) {
	authed := khatru.GetAuthed(ctx)
	if authed == "" {
		return true, "auth-required: authenticate before publishing"
	}
	if !p.isAdmitted(authed) {
		return true, "restricted: sync pubkey is not admitted"
	}
	if authed != event.PubKey {
		return true, "restricted: authenticated pubkey must match event author"
	}
	if !p.writes.Allow(authed) {
		return true, "rate-limited: too many snapshot writes"
	}
	if err := p.ValidateEvent(event); err != nil {
		return true, "invalid: " + err.Error()
	}
	return false, ""
}

func (p *Policy) OnRequest(ctx context.Context, filter nostr.Filter) (bool, string) {
	authed := khatru.GetAuthed(ctx)
	if authed == "" {
		return true, "auth-required: authenticate before reading"
	}
	if !p.isAdmitted(authed) {
		return true, "restricted: sync pubkey is not admitted"
	}
	if !p.reads.Allow(authed) {
		return true, "rate-limited: too many snapshot requests"
	}
	if err := p.ValidateFilter(authed, filter); err != nil {
		return true, "restricted: " + err.Error()
	}
	return false, ""
}

func (p *Policy) isAdmitted(pubkey string) bool {
	if p.config.AdmissionMode == AdmissionOpen {
		return true
	}
	_, allowed := p.config.AllowedPubkeys[pubkey]
	return p.config.AdmissionMode == AdmissionAllowlist && allowed
}

func (p *Policy) limiterSizes() (writes int, reads int) {
	return p.writes.size(), p.reads.size()
}

func (p *Policy) ValidateEvent(event *nostr.Event) error {
	if event.Kind != p.config.Kind {
		return fmt.Errorf("kind must be %d", p.config.Kind)
	}
	if len(event.Content) == 0 {
		return errors.New("content must not be empty")
	}
	if len(event.Content) > p.config.MaxContentBytes {
		return fmt.Errorf("content exceeds %d bytes", p.config.MaxContentBytes)
	}

	expected := map[string]string{
		"d":      p.config.Identifier,
		"schema": p.config.Schema,
	}
	seen := make(map[string]bool, 3)
	var previous string
	if len(event.Tags) != 3 {
		return errors.New("exactly d, prev, and schema tags are required")
	}
	for _, tag := range event.Tags {
		if len(tag) != 2 {
			return errors.New("tags must contain exactly a name and value")
		}
		name, value := tag[0], tag[1]
		if seen[name] {
			return fmt.Errorf("duplicate %q tag", name)
		}
		seen[name] = true
		switch name {
		case "prev":
			previous = value
		case "d", "schema":
			if value != expected[name] {
				return fmt.Errorf("unexpected %s tag", name)
			}
		default:
			return fmt.Errorf("public tag %q is not allowed", name)
		}
	}
	if !seen["d"] || !seen["prev"] || !seen["schema"] {
		return errors.New("d, prev, and schema tags are required")
	}
	if previous != "" && !lowercaseEventID.MatchString(previous) {
		return errors.New("prev must be empty or a lowercase event ID")
	}

	now := p.config.Now()
	created := time.Unix(int64(event.CreatedAt), 0)
	if created.Before(now.Add(-p.config.MaxClockSkew)) || created.After(now.Add(p.config.MaxClockSkew)) {
		return errors.New("created_at outside allowed clock skew")
	}
	if !event.CheckID() {
		return errors.New("event ID is computed incorrectly")
	}
	valid, err := event.CheckSignature()
	if err != nil || !valid {
		return errors.New("event signature is invalid")
	}
	return nil
}

func (p *Policy) ValidateFilter(authed string, filter nostr.Filter) error {
	if len(filter.Authors) != 1 || filter.Authors[0] != authed {
		return errors.New("filter must contain exactly the authenticated author")
	}
	if len(filter.Kinds) != 1 || filter.Kinds[0] != p.config.Kind {
		return fmt.Errorf("filter must contain only kind %d", p.config.Kind)
	}
	if len(filter.Tags) != 1 || len(filter.Tags["d"]) != 1 || filter.Tags["d"][0] != p.config.Identifier {
		return errors.New("filter must contain only the v0 d tag")
	}
	if filter.Search != "" {
		return errors.New("search is not supported")
	}
	if filter.Limit < 0 || filter.Limit > 8 {
		return errors.New("limit must be between 0 and 8")
	}
	return nil
}

type fixedWindowLimiter struct {
	mu          sync.Mutex
	limit       int
	window      time.Duration
	now         func() time.Time
	items       map[string]windowCount
	nextCleanup time.Time
}

type windowCount struct {
	start time.Time
	count int
}

func newFixedWindowLimiter(limit int, window time.Duration, now func() time.Time) *fixedWindowLimiter {
	return &fixedWindowLimiter{limit: limit, window: window, now: now, items: make(map[string]windowCount)}
}

func (l *fixedWindowLimiter) Allow(key string) bool {
	if l.limit <= 0 {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if l.nextCleanup.IsZero() || !now.Before(l.nextCleanup) {
		for itemKey, item := range l.items {
			if now.Sub(item.start) >= l.window {
				delete(l.items, itemKey)
			}
		}
		l.nextCleanup = now.Add(l.window)
	}
	item := l.items[key]
	if item.start.IsZero() || now.Sub(item.start) >= l.window {
		l.items[key] = windowCount{start: now, count: 1}
		return true
	}
	if item.count >= l.limit {
		return false
	}
	item.count++
	l.items[key] = item
	return true
}

func (l *fixedWindowLimiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.items)
}
