---- MODULE RelayTransport ----
EXTENDS Naturals, Sequences, FiniteSets
VARIABLE s
Init == \E init_mode \in {"query","publish","watch"}: s = [mode |-> init_mode, phase |-> "connect", retries |-> 0, authed |-> FALSE, published |-> FALSE, delivered |-> FALSE]
Challenge == /\ s.phase = "connect"
             /\ s' = [s EXCEPT !.phase = "auth"]
AuthAccepted == /\ s.phase = "auth"
                /\ s' = [s EXCEPT !.phase = "active", !.authed = TRUE]
AuthRejected == /\ s.phase = "auth"
                /\ s' = [s EXCEPT !.phase = IF s.mode = "watch" THEN "backoff" ELSE "failed"]
SendPublish == /\ s.mode = "publish" /\ s.phase = "active" /\ s.authed
               /\ s' = [s EXCEPT !.phase = "waiting-ok", !.published = TRUE]
MatchingOK == /\ s.phase = "waiting-ok"
              /\ s' = [s EXCEPT !.phase = "done"]
MatchingEOSE == /\ s.mode = "query" /\ s.phase = "active" /\ s.authed
                /\ s' = [s EXCEPT !.phase = "done"]
DeliverValidEvent == /\ s.mode = "watch" /\ s.phase = "active" /\ s.authed
                     /\ s' = [s EXCEPT !.delivered = TRUE]
TransientLoss == /\ s.phase \in {"connect","auth","active","waiting-ok"}
                 /\ s' = [s EXCEPT !.phase = IF s.mode = "publish" THEN "ambiguous" ELSE "backoff", !.authed = FALSE, !.delivered = FALSE]
RetryReadOrWatch == /\ s.phase = "backoff" /\ s.retries < 2 /\ s.mode # "publish"
                    /\ s' = [s EXCEPT !.phase = "connect", !.retries = @ + 1]
RetryBudgetSpent == /\ s.phase = "backoff" /\ s.retries = 2 /\ s.mode = "query"
                    /\ s' = [s EXCEPT !.phase = "failed"]
StopWatcher == /\ s.mode = "watch" /\ s.phase # "stopped"
               /\ s' = [s EXCEPT !.phase = "stopped", !.authed = FALSE, !.delivered = FALSE]
Done == UNCHANGED s
Next ==
  \/ Challenge
  \/ AuthAccepted
  \/ AuthRejected
  \/ SendPublish
  \/ MatchingOK
  \/ MatchingEOSE
  \/ DeliverValidEvent
  \/ TransientLoss
  \/ RetryReadOrWatch
  \/ RetryBudgetSpent
  \/ StopWatcher
  \/ Done
PublishRequiresAuth == s.published => s.phase \in {"waiting-ok","done","ambiguous"}
DeliveryRequiresActiveAuth == s.delivered => s.authed /\ s.phase = "active"
PublishNeverAutomaticallyRetries == s.mode = "publish" => s.retries = 0
====
