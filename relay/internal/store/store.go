package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"net/url"
	"path/filepath"

	"github.com/nbd-wtf/go-nostr"
	_ "modernc.org/sqlite"
)

var (
	ErrConflict = errors.New("stale previous event")
	ErrNotFound = errors.New("head not found")
)

type AdvanceResult struct {
	Duplicate bool
}

type Repository struct {
	db         *sql.DB
	maxHistory int
}

func Open(path string, maxHistory int) (*Repository, error) {
	if maxHistory < 1 {
		return nil, errors.New("max history must be at least 1")
	}

	dsn := (&url.URL{
		Scheme:   "file",
		Path:     filepath.ToSlash(path),
		RawQuery: "_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)",
	}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// V0 is one process. One connection makes the read-check-write CAS a simple,
	// serial SQLite transaction without an application mutex or retry loop.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	repo := &Repository{db: db, maxHistory: maxHistory}
	if err := repo.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *Repository) initialize(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    pubkey      TEXT NOT NULL,
    identifier  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    event_json  BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_wallet_created
    ON events(pubkey, identifier, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS heads (
    pubkey      TEXT NOT NULL,
    identifier  TEXT NOT NULL,
    event_id    TEXT NOT NULL REFERENCES events(id),
    PRIMARY KEY(pubkey, identifier)
);`
	if _, err := r.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("initialize sqlite: %w", err)
	}
	return nil
}

func (r *Repository) Close() error {
	return r.db.Close()
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.db.PingContext(ctx)
}

func (r *Repository) Advance(ctx context.Context, event nostr.Event) (AdvanceResult, error) {
	identifier := tagValue(event.Tags, "d")
	previous := tagValue(event.Tags, "prev")
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return AdvanceResult{}, fmt.Errorf("marshal event: %w", err)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AdvanceResult{}, fmt.Errorf("begin advance: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM events WHERE id = ?)`, event.ID).Scan(&exists); err != nil {
		return AdvanceResult{}, fmt.Errorf("check duplicate: %w", err)
	}
	if exists == 1 {
		if err := tx.Commit(); err != nil {
			return AdvanceResult{}, fmt.Errorf("commit duplicate: %w", err)
		}
		return AdvanceResult{Duplicate: true}, nil
	}

	var current string
	err = tx.QueryRowContext(ctx,
		`SELECT event_id FROM heads WHERE pubkey = ? AND identifier = ?`,
		event.PubKey, identifier,
	).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		current = ""
	} else if err != nil {
		return AdvanceResult{}, fmt.Errorf("read current head: %w", err)
	}
	if previous != current {
		return AdvanceResult{}, fmt.Errorf("%w: current head is %q", ErrConflict, current)
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO events(id, pubkey, identifier, created_at, event_json) VALUES (?, ?, ?, ?, ?)`,
		event.ID, event.PubKey, identifier, int64(event.CreatedAt), eventJSON,
	); err != nil {
		return AdvanceResult{}, fmt.Errorf("insert event: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO heads(pubkey, identifier, event_id) VALUES (?, ?, ?)
ON CONFLICT(pubkey, identifier) DO UPDATE SET event_id = excluded.event_id`,
		event.PubKey, identifier, event.ID,
	); err != nil {
		return AdvanceResult{}, fmt.Errorf("advance head: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM events
WHERE pubkey = ? AND identifier = ? AND id NOT IN (
    SELECT id FROM events
    WHERE pubkey = ? AND identifier = ?
    ORDER BY rowid DESC
    LIMIT ?
)`, event.PubKey, identifier, event.PubKey, identifier, r.maxHistory); err != nil {
		return AdvanceResult{}, fmt.Errorf("prune history: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return AdvanceResult{}, fmt.Errorf("commit advance: %w", err)
	}
	return AdvanceResult{}, nil
}

func (r *Repository) Head(ctx context.Context, pubkey string, identifier string) (nostr.Event, error) {
	var eventJSON []byte
	err := r.db.QueryRowContext(ctx, `
SELECT e.event_json
FROM heads h JOIN events e ON e.id = h.event_id
WHERE h.pubkey = ? AND h.identifier = ?`, pubkey, identifier).Scan(&eventJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nostr.Event{}, ErrNotFound
	}
	if err != nil {
		return nostr.Event{}, fmt.Errorf("read head: %w", err)
	}
	return decodeEvent(eventJSON)
}

func (r *Repository) Query(ctx context.Context, filter nostr.Filter) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		if len(filter.Authors) != 1 {
			return
		}
		rows, err := r.db.QueryContext(ctx,
			`SELECT event_json FROM events WHERE pubkey = ? ORDER BY rowid DESC`,
			filter.Authors[0],
		)
		if err != nil {
			return
		}
		defer rows.Close()
		count := 0
		for rows.Next() {
			var raw []byte
			if rows.Scan(&raw) != nil {
				return
			}
			event, err := decodeEvent(raw)
			if err != nil || !filter.Matches(&event) {
				continue
			}
			if filter.Limit > 0 && count >= filter.Limit {
				return
			}
			count++
			if !yield(event) {
				return
			}
		}
	}
}

func decodeEvent(raw []byte) (nostr.Event, error) {
	var event nostr.Event
	if err := json.Unmarshal(raw, &event); err != nil {
		return nostr.Event{}, fmt.Errorf("decode stored event: %w", err)
	}
	return event, nil
}

func tagValue(tags nostr.Tags, name string) string {
	tag := tags.Find(name)
	if len(tag) < 2 {
		return ""
	}
	return tag[1]
}
