package appconfig

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

const (
	defaultListenAddress = "127.0.0.1:3334"
	defaultDatabasePath  = "./data/cashu-sync.db"
	defaultMaxHistory    = 8
)

type Config struct {
	Host         string
	Port         int
	DatabasePath string
	MaxHistory   int
}

type LookupEnv func(string) (string, bool)

func Load(lookup LookupEnv) (Config, error) {
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

	return Config{
		Host:         host,
		Port:         port,
		DatabasePath: databasePath,
		MaxHistory:   maxHistory,
	}, nil
}

func envOrDefault(lookup LookupEnv, name string, fallback string) string {
	if value, ok := lookup(name); ok {
		return strings.TrimSpace(value)
	}
	return fallback
}
