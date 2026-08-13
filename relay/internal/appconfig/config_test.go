package appconfig

import "testing"

func TestLoadDefaults(t *testing.T) {
	config, err := Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}
	if config.Host != "127.0.0.1" || config.Port != 3334 || config.DatabasePath != "./data/cashu-sync.db" || config.MaxHistory != 8 {
		t.Fatalf("unexpected defaults: %+v", config)
	}
}

func TestLoadOverrides(t *testing.T) {
	values := map[string]string{
		"CASHU_SYNC_LISTEN_ADDR": ":8080",
		"CASHU_SYNC_DB_PATH":     "/var/lib/cashu-sync/relay.db",
		"CASHU_SYNC_MAX_HISTORY": "3",
	}
	config, err := Load(func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load overrides: %v", err)
	}
	if config.Host != "" || config.Port != 8080 || config.DatabasePath != values["CASHU_SYNC_DB_PATH"] || config.MaxHistory != 3 {
		t.Fatalf("unexpected overrides: %+v", config)
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
