---- MODULE BrowserLifecycle ----
EXTENDS Naturals, Sequences, FiniteSets
VARIABLE s
Init == \E init_pending \in BOOLEAN: s = [phase |-> "starting", pending |-> init_pending, badge |-> "starting", scanner |-> "closed", update |-> "none"]
NotConfigured == /\ s.phase = "starting"
                 /\ s' = [s EXCEPT !.phase = "unconfigured", !.badge = "pair-or-restore"]
BootReady == /\ s.phase = "starting" /\ ~s.pending
             /\ s' = [s EXCEPT !.phase = "ready", !.badge = "synchronized"]
BootPending == /\ s.phase = "starting" /\ s.pending
               /\ s' = [s EXCEPT !.phase = "recovering", !.badge = "recovering"]
BootError == /\ s.phase = "starting"
             /\ s' = [s EXCEPT !.phase = "recovering", !.badge = "error"]
WatchDisconnected == /\ s.phase \in {"ready","recovering"}
                     /\ s' = [s EXCEPT !.badge = "reconnecting"]
WatchConnected == /\ s.phase \in {"ready","recovering"}
                  /\ s' = [s EXCEPT !.badge = "synchronized"]
ResumeSettled == /\ s.phase = "recovering"
                 /\ s' = [s EXCEPT !.phase = "ready", !.pending = FALSE, !.badge = "synchronized"]
AskCamera == /\ s.scanner = "closed"
             /\ s' = [s EXCEPT !.scanner = "requesting"]
AllowCamera == /\ s.scanner = "requesting"
               /\ s' = [s EXCEPT !.scanner = "scanning"]
DenyCamera == /\ s.scanner = "requesting"
              /\ s' = [s EXCEPT !.scanner = "error"]
CloseCamera == /\ s.scanner # "closed"
               /\ s' = [s EXCEPT !.scanner = "closed"]
WorkerInstalled == /\ s.update = "none"
                   /\ s' = [s EXCEPT !.update = "waiting"]
ReloadUpdatedPage == /\ s.update = "waiting"
                     /\ s' = [s EXCEPT !.update = "applied", !.phase = "starting", !.badge = "starting", !.scanner = "closed"]
Done == UNCHANGED s
Next ==
  \/ NotConfigured
  \/ BootReady
  \/ BootPending
  \/ BootError
  \/ WatchDisconnected
  \/ WatchConnected
  \/ ResumeSettled
  \/ AskCamera
  \/ AllowCamera
  \/ DenyCamera
  \/ CloseCamera
  \/ WorkerInstalled
  \/ ReloadUpdatedPage
  \/ Done
SynchronizedMeansNoPendingJournal == s.badge = "synchronized" => ~s.pending
====
