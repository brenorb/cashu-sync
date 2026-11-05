package main

import (
	"testing"

	"github.com/silentlink/cashu-sync/relay/internal/appconfig"
	syncrelay "github.com/silentlink/cashu-sync/relay/internal/relay"
)

func TestRelayConfigWiresRateLimitsInBothAdmissionModes(t *testing.T) {
	for _, mode := range []appconfig.AdmissionMode{appconfig.AdmissionOpen, appconfig.AdmissionAllowlist} {
		t.Run(string(mode), func(t *testing.T) {
			config := appconfig.Config{
				AdmissionMode:     mode,
				WritesPerMinute:   17,
				RequestsPerMinute: 29,
				AllowedPubkeys:    map[string]struct{}{"allowed-key": {}},
				ServiceURL:        "https://sync.example.com",
			}
			policy := relayConfig(config)
			if policy.WritesPerMinute != 17 || policy.RequestsPerMinute != 29 {
				t.Fatalf("startup lost rate settings: writes=%d requests=%d", policy.WritesPerMinute, policy.RequestsPerMinute)
			}
			if mode == appconfig.AdmissionAllowlist {
				if policy.AdmissionMode != syncrelay.AdmissionAllowlist || policy.ServiceURL != config.ServiceURL {
					t.Fatalf("allowlist settings lost: %+v", policy)
				}
				if _, ok := policy.AllowedPubkeys["allowed-key"]; !ok {
					t.Fatal("allowlist key lost")
				}
			} else if policy.AdmissionMode != syncrelay.AdmissionOpen || len(policy.AllowedPubkeys) != 0 || policy.ServiceURL != "" {
				t.Fatalf("open mode changed admission policy: %+v", policy)
			}
		})
	}
}
