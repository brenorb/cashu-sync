---- MODULE PairingRelay ----
EXTENDS Naturals, Sequences, FiniteSets
VARIABLE s
Init == s = [entry |-> "none", age |-> "fresh", capture |-> FALSE, delivered |-> FALSE, captureWasValid |-> FALSE]
SaveGift == /\ s.entry = "none"
            /\ s' = [s EXCEPT !.entry = "stored", !.age = "fresh"]
AgeOut == /\ s.entry = "stored" /\ s.age = "fresh"
          /\ s' = [s EXCEPT !.age = "expired"]
Prune == /\ s.entry = "stored" /\ s.age = "expired"
         /\ s' = [s EXCEPT !.entry = "none"]
MatchRecipient == /\ s.entry = "stored" /\ s.age = "fresh" /\ ~s.capture
                  /\ s' = [s EXCEPT !.capture = TRUE, !.captureWasValid = TRUE]
SendCaptured == /\ s.capture /\ ~s.delivered
                /\ s' = [s EXCEPT !.delivered = TRUE]
CloseOrCancel == /\ s.capture
                 /\ s' = [s EXCEPT !.capture = FALSE, !.delivered = FALSE, !.captureWasValid = FALSE]
Restart == /\ s.entry = "stored"
           /\ s' = [s EXCEPT !.entry = "none", !.capture = FALSE, !.delivered = FALSE, !.captureWasValid = FALSE]
Done == UNCHANGED s
Next ==
  \/ SaveGift
  \/ AgeOut
  \/ Prune
  \/ MatchRecipient
  \/ SendCaptured
  \/ CloseOrCancel
  \/ Restart
  \/ Done
OnlyFreshMatchingCaptureDelivered == s.delivered => s.capture /\ s.captureWasValid
====
