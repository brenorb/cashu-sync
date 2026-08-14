package main

import (
	"context"
	"errors"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/silentlink/cashu-sync/relay/internal/pairingrelay"
)

func main() {
	if err := run(); err != nil {
		log.Printf("cashu-sync-pairing-relay: %v", err)
		os.Exit(1)
	}
}

func run() error {
	addr := os.Getenv("CASHU_SYNC_PAIRING_LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:3335"
	}
	maxAge := 5 * time.Minute
	if raw := os.Getenv("CASHU_SYNC_PAIRING_MAX_AGE_SECONDS"); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds < 30 || seconds > 900 {
			return errors.New("CASHU_SYNC_PAIRING_MAX_AGE_SECONDS must be between 30 and 900")
		}
		maxAge = time.Duration(seconds) * time.Second
	}
	host, portText, err := net.SplitHostPort(addr)
	if err != nil {
		return errors.New("CASHU_SYNC_PAIRING_LISTEN_ADDR must be host:port")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("CASHU_SYNC_PAIRING_LISTEN_ADDR port must be between 1 and 65535")
	}
	server := pairingrelay.New(pairingrelay.Config{MaxAge: maxAge})
	started := make(chan bool)
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Relay.Start(host, port, started) }()
	select {
	case <-started:
		log.Printf("pairing relay listening on %s", server.Relay.Addr)
	case err := <-serveErr:
		return err
	}
	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-serveErr:
		return err
	case <-signalContext.Done():
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Relay.Shutdown(shutdownContext)
	select {
	case err := <-serveErr:
		return err
	case <-shutdownContext.Done():
		return errors.New("pairing relay shutdown timed out")
	}
}
