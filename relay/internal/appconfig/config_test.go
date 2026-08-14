package appconfig

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	config, err := Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}
	if config.Host != "127.0.0.1" || config.Port != 3334 || config.DatabasePath != "./data/cashu-sync.db" || config.MaxHistory != 8 || config.AdmissionMode != AdmissionOpen {
		t.Fatalf("unexpected defaults: %+v", config)
	}
}

func TestOpenAdmissionAllowsOnlyLoopbackBind(t *testing.T) {
	tests := []struct {
		name       string
		listen     string
		addresses  []net.IP
		resolveErr error
		wantError  bool
	}{
		{name: "IPv4", listen: "127.0.0.1:8080"},
		{name: "IPv4 loopback range", listen: "127.8.9.10:8080"},
		{name: "IPv6", listen: "[::1]:8080"},
		{name: "localhost all loopback", listen: "localhost:8080", addresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}},
		{name: "localhost mixed resolution", listen: "localhost:8080", addresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("192.0.2.1")}, wantError: true},
		{name: "localhost no addresses", listen: "localhost:8080", wantError: true},
		{name: "localhost resolution failure", listen: "localhost:8080", resolveErr: errors.New("DNS failed"), wantError: true},
		{name: "loopback alias", listen: "relay.test:8080", addresses: []net.IP{net.ParseIP("127.0.0.1")}, wantError: true},
		{name: "IPv4 wildcard", listen: "0.0.0.0:8080", wantError: true},
		{name: "IPv6 wildcard", listen: "[::]:8080", wantError: true},
		{name: "empty wildcard", listen: ":8080", wantError: true},
		{name: "public literal", listen: "192.0.2.1:8080", wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config, err := load(
				mapLookup(map[string]string{
					"CASHU_SYNC_ADMISSION_MODE": string(AdmissionOpen),
					"CASHU_SYNC_LISTEN_ADDR":    test.listen,
				}),
				func(string) ([]net.IP, error) { return test.addresses, test.resolveErr },
			)
			if test.wantError && err == nil {
				t.Fatalf("load accepted unsafe open bind: %+v", config)
			}
			if !test.wantError && err != nil {
				t.Fatalf("load rejected loopback bind: %v", err)
			}
		})
	}
}

func TestDemoPublicOpenExplicitlyAllowsPublicBind(t *testing.T) {
	config, err := load(
		mapLookup(map[string]string{
			"CASHU_SYNC_ADMISSION_MODE":   string(AdmissionOpen),
			"CASHU_SYNC_LISTEN_ADDR":      "0.0.0.0:8080",
			"CASHU_SYNC_DEMO_PUBLIC_OPEN": "true",
		}),
		func(string) ([]net.IP, error) { return nil, nil },
	)
	if err != nil {
		t.Fatalf("demo public-open configuration rejected: %v", err)
	}
	if config.AdmissionMode != AdmissionOpen {
		t.Fatalf("admission mode = %q", config.AdmissionMode)
	}
}

func TestLoadAllowlistMode(t *testing.T) {
	pubkeyA := strings.Repeat("a", 64)
	pubkeyB := strings.Repeat("b", 64)
	allowlist := filepath.Join(t.TempDir(), "allowed-pubkeys")
	if err := os.WriteFile(allowlist, []byte("# enrolled wallets\n"+pubkeyA+"\n\n"+pubkeyB+"\n"), 0o600); err != nil {
		t.Fatalf("write allowlist: %v", err)
	}
	values := map[string]string{
		"CASHU_SYNC_ADMISSION_MODE": string(AdmissionAllowlist),
		"CASHU_SYNC_LISTEN_ADDR":    "127.0.0.1:8080",
		"CASHU_SYNC_DB_PATH":        "/var/lib/cashu-sync/relay.db",
		"CASHU_SYNC_MAX_HISTORY":    "3",
		"CASHU_SYNC_ALLOWLIST_PATH": allowlist,
		"CASHU_SYNC_SERVICE_URL":    "wss://sync.example.com/",
	}
	config, err := Load(mapLookup(values))
	if err != nil {
		t.Fatalf("load overrides: %v", err)
	}
	if config.Host != "127.0.0.1" || config.Port != 8080 || config.DatabasePath != values["CASHU_SYNC_DB_PATH"] || config.MaxHistory != 3 {
		t.Fatalf("unexpected overrides: %+v", config)
	}
	if config.ServiceURL != "https://sync.example.com" {
		t.Fatalf("service URL = %q", config.ServiceURL)
	}
	if len(config.AllowedPubkeys) != 2 {
		t.Fatalf("allowed pubkeys = %v", config.AllowedPubkeys)
	}
	if _, ok := config.AllowedPubkeys[pubkeyA]; !ok {
		t.Fatal("first pubkey not loaded")
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "listen without port", key: "CASHU_SYNC_LISTEN_ADDR", value: "localhost"},
		{name: "invalid port", key: "CASHU_SYNC_LISTEN_ADDR", value: "localhost:70000"},
		{name: "empty database", key: "CASHU_SYNC_DB_PATH", value: " "},
		{name: "zero history", key: "CASHU_SYNC_MAX_HISTORY", value: "0"},
		{name: "excessive history", key: "CASHU_SYNC_MAX_HISTORY", value: "101"},
		{name: "unknown admission mode", key: "CASHU_SYNC_ADMISSION_MODE", value: "public"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := Load(func(name string) (string, bool) {
				if name == test.key {
					return test.value, true
				}
				return "", false
			})
			if err == nil {
				t.Fatal("expected configuration error")
			}
		})
	}
}

func TestAllowlistModeRejectsUnsafeConfiguration(t *testing.T) {
	validPath := filepath.Join(t.TempDir(), "allowed-pubkeys")
	if err := os.WriteFile(validPath, []byte(strings.Repeat("a", 64)+"\n"), 0o600); err != nil {
		t.Fatalf("write allowlist: %v", err)
	}
	tests := []struct {
		name       string
		serviceURL string
		path       string
		contents   string
	}{
		{name: "missing service URL", path: validPath},
		{name: "plaintext service URL", serviceURL: "http://sync.example.com", path: validPath},
		{name: "service URL path", serviceURL: "https://sync.example.com/relay", path: validPath},
		{name: "service URL query", serviceURL: "https://sync.example.com?mode=relay", path: validPath},
		{name: "empty service URL query", serviceURL: "https://sync.example.com?", path: validPath},
		{name: "service URL fragment", serviceURL: "https://sync.example.com#relay", path: validPath},
		{name: "service URL credentials", serviceURL: "https://user@sync.example.com", path: validPath},
		{name: "missing allowlist", serviceURL: "https://sync.example.com"},
		{name: "unreadable allowlist", serviceURL: "https://sync.example.com", path: filepath.Join(t.TempDir(), "missing")},
		{name: "empty allowlist", serviceURL: "https://sync.example.com", contents: "# no wallets\n"},
		{name: "uppercase pubkey", serviceURL: "https://sync.example.com", contents: strings.Repeat("A", 64)},
		{name: "short pubkey", serviceURL: "https://sync.example.com", contents: "abcd"},
		{name: "duplicate pubkey", serviceURL: "https://sync.example.com", contents: strings.Repeat("a", 64) + "\n" + strings.Repeat("a", 64)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := test.path
			if test.contents != "" {
				path = filepath.Join(t.TempDir(), "allowlist")
				if err := os.WriteFile(path, []byte(test.contents), 0o600); err != nil {
					t.Fatalf("write allowlist: %v", err)
				}
			}
			_, err := Load(mapLookup(map[string]string{
				"CASHU_SYNC_ADMISSION_MODE": string(AdmissionAllowlist),
				"CASHU_SYNC_SERVICE_URL":    test.serviceURL,
				"CASHU_SYNC_ALLOWLIST_PATH": path,
			}))
			if err == nil {
				t.Fatal("expected unsafe allowlist configuration to fail")
			}
		})
	}
}

func mapLookup(values map[string]string) LookupEnv {
	return func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}
}
