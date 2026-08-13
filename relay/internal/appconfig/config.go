package appconfig

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	defaultListenAddress = "127.0.0.1:3334"
	defaultDatabasePath  = "./data/cashu-sync.db"
	defaultMaxHistory    = 8
)

type AdmissionMode string

const (
	AdmissionOpen      AdmissionMode = "open"
	AdmissionAllowlist AdmissionMode = "allowlist"
)

var lowercasePubkey = regexp.MustCompile(`^[0-9a-f]{64}$`)

type Config struct {
	Host           string
	Port           int
	DatabasePath   string
	MaxHistory     int
	AdmissionMode  AdmissionMode
	ServiceURL     string
	AllowedPubkeys map[string]struct{}
}

type LookupEnv func(string) (string, bool)
type lookupIPFunc func(string) ([]net.IP, error)

func Load(lookup LookupEnv) (Config, error) {
	return load(lookup, net.LookupIP)
}

func load(lookup LookupEnv, lookupIP lookupIPFunc) (Config, error) {
	listen := envOrDefault(lookup, "CASHU_SYNC_LISTEN_ADDR", defaultListenAddress)
	host, portText, err := net.SplitHostPort(listen)
	if err != nil {
		return Config{}, fmt.Errorf("CASHU_SYNC_LISTEN_ADDR must be host:port: %w", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return Config{}, errors.New("CASHU_SYNC_LISTEN_ADDR port must be between 1 and 65535")
	}

	databasePath := strings.TrimSpace(envOrDefault(lookup, "CASHU_SYNC_DB_PATH", defaultDatabasePath))
	if databasePath == "" {
		return Config{}, errors.New("CASHU_SYNC_DB_PATH must not be empty")
	}

	maxHistoryText := envOrDefault(lookup, "CASHU_SYNC_MAX_HISTORY", strconv.Itoa(defaultMaxHistory))
	maxHistory, err := strconv.Atoi(maxHistoryText)
	if err != nil || maxHistory < 1 || maxHistory > 100 {
		return Config{}, errors.New("CASHU_SYNC_MAX_HISTORY must be between 1 and 100")
	}

	mode := AdmissionMode(envOrDefault(lookup, "CASHU_SYNC_ADMISSION_MODE", string(AdmissionOpen)))
	config := Config{
		Host:          host,
		Port:          port,
		DatabasePath:  databasePath,
		MaxHistory:    maxHistory,
		AdmissionMode: mode,
	}
	switch mode {
	case AdmissionOpen:
		if err := requireLoopback(host, lookupIP); err != nil {
			return Config{}, fmt.Errorf("open admission requires a loopback bind: %w", err)
		}
	case AdmissionAllowlist:
		serviceURL, err := canonicalServiceURL(envOrDefault(lookup, "CASHU_SYNC_SERVICE_URL", ""))
		if err != nil {
			return Config{}, err
		}
		path := strings.TrimSpace(envOrDefault(lookup, "CASHU_SYNC_ALLOWLIST_PATH", ""))
		if path == "" {
			return Config{}, errors.New("CASHU_SYNC_ALLOWLIST_PATH is required in allowlist mode")
		}
		pubkeys, err := loadAllowlist(path)
		if err != nil {
			return Config{}, err
		}
		config.ServiceURL = serviceURL
		config.AllowedPubkeys = pubkeys
	default:
		return Config{}, errors.New("CASHU_SYNC_ADMISSION_MODE must be open or allowlist")
	}

	return config, nil
}

func requireLoopback(host string, lookupIP lookupIPFunc) error {
	if host == "" {
		return errors.New("wildcard address is not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !ip.IsLoopback() {
			return fmt.Errorf("%s is not loopback", host)
		}
		return nil
	}
	if !strings.EqualFold(host, "localhost") {
		return fmt.Errorf("hostname %s is not the explicit localhost name", host)
	}
	addresses, err := lookupIP(host)
	if err != nil {
		return fmt.Errorf("resolve %s: %w", host, err)
	}
	if len(addresses) == 0 {
		return fmt.Errorf("%s resolved to no addresses", host)
	}
	for _, address := range addresses {
		if address == nil || !address.IsLoopback() {
			return fmt.Errorf("%s resolved to non-loopback address %s", host, address)
		}
	}
	return nil
}

func canonicalServiceURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("parse CASHU_SYNC_SERVICE_URL: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "wss" {
		return "", errors.New("CASHU_SYNC_SERVICE_URL must use https or wss")
	}
	if parsed.Hostname() == "" || parsed.User != nil {
		return "", errors.New("CASHU_SYNC_SERVICE_URL must be an absolute origin without credentials")
	}
	if (parsed.Path != "" && parsed.Path != "/") || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return "", errors.New("CASHU_SYNC_SERVICE_URL must not contain a path, query, or fragment")
	}
	parsed.Scheme = "https"
	parsed.Path = ""
	return parsed.String(), nil
}

func loadAllowlist(path string) (map[string]struct{}, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open CASHU_SYNC_ALLOWLIST_PATH: %w", err)
	}
	defer file.Close()

	pubkeys := make(map[string]struct{})
	scanner := bufio.NewScanner(file)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !lowercasePubkey.MatchString(line) {
			return nil, fmt.Errorf("allowlist line %d must be a 64-character lowercase hex pubkey", lineNumber)
		}
		if _, exists := pubkeys[line]; exists {
			return nil, fmt.Errorf("allowlist line %d duplicates pubkey %s", lineNumber, line)
		}
		pubkeys[line] = struct{}{}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read CASHU_SYNC_ALLOWLIST_PATH: %w", err)
	}
	if len(pubkeys) == 0 {
		return nil, errors.New("CASHU_SYNC_ALLOWLIST_PATH must contain at least one pubkey")
	}
	return pubkeys, nil
}

func envOrDefault(lookup LookupEnv, name string, fallback string) string {
	if value, ok := lookup(name); ok {
		return strings.TrimSpace(value)
	}
	return fallback
}
