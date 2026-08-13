package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/silentlink/cashu-sync/relay/internal/appconfig"
	syncrelay "github.com/silentlink/cashu-sync/relay/internal/relay"
	"github.com/silentlink/cashu-sync/relay/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Printf("cashu-sync-relay: %v", err)
		os.Exit(1)
	}
}

func run() error {
	config, err := appconfig.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	if directory := filepath.Dir(config.DatabasePath); directory != "." {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return fmt.Errorf("create database directory: %w", err)
		}
	}

	repository, err := store.Open(config.DatabasePath, config.MaxHistory)
	if err != nil {
		return err
	}
	defer repository.Close()

	relayConfig := syncrelay.DefaultConfig()
	if config.AdmissionMode == appconfig.AdmissionAllowlist {
		relayConfig.AdmissionMode = syncrelay.AdmissionAllowlist
		relayConfig.AllowedPubkeys = config.AllowedPubkeys
		relayConfig.ServiceURL = config.ServiceURL
	}
	server := syncrelay.New(repository, relayConfig)
	started := make(chan bool)
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Relay.Start(config.Host, config.Port, started)
	}()

	select {
	case <-started:
		log.Printf("cashu-sync-relay listening on %s with database %s", server.Relay.Addr, config.DatabasePath)
	case err := <-serveErr:
		return fmt.Errorf("start relay: %w", err)
	}

	signalContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("serve relay: %w", err)
		}
		return nil
	case <-signalContext.Done():
	}

	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	server.Relay.Shutdown(shutdownContext)
	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("stop relay: %w", err)
		}
		return nil
	case <-shutdownContext.Done():
		return errors.New("relay shutdown timed out")
	}
}
