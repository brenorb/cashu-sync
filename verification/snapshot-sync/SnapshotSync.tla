---- MODULE SnapshotSync ----
VARIABLES phase, relation, pending, evidence, proof, nextProof, verdict, applied, confirmed
vars == <<phase,relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
Init == /\ phase = "local" /\ relation \in {"current","child","retained","pruned","missing","invalid","bootstrap"}
        /\ pending \in BOOLEAN /\ evidence \in BOOLEAN
        /\ proof \in {"ordinary","journal"} /\ nextProof = proof
        /\ verdict = "none" /\ applied = FALSE /\ confirmed = FALSE
ReadHead == /\ phase = "local" /\ phase' = "reading"
            /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
NoChange == /\ phase = "reading" /\ relation = "current" /\ phase' = "synchronized"
            /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
ApplyVerified == /\ phase = "reading" /\ relation \in {"child","retained","bootstrap"}
                 /\ (relation # "bootstrap" \/ ~pending) /\ (~pending \/ evidence)
                 /\ phase' = "synchronized" /\ applied' = TRUE
                 /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,confirmed>>
ReadMint == /\ phase = "reading" /\ relation = "pruned" /\ (~pending \/ evidence)
            /\ phase' = "checking-mint"
            /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
PreserveOnFailure == /\ (phase = "reading" /\ (relation \in {"missing","invalid"} \/ (pending /\ ~evidence)))
                         \/ phase = "checking-mint"
                     /\ phase' = "preserved"
                     /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
Reconcile == /\ phase = "checking-mint" /\ phase' = "corrected"
             /\ verdict' \in {"spent","pending","unspent"}
             /\ nextProof' = IF proof = "journal" THEN proof
                             ELSE CASE verdict' = "spent" -> "removed"
                                    [] verdict' = "pending" -> "reserved"
                                    [] OTHER -> "ordinary"
             /\ applied' = TRUE /\ UNCHANGED <<relation,pending,evidence,proof,confirmed>>
PublishCorrection == /\ phase = "corrected" /\ phase' = "publishing"
                     /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
AcceptCorrection == /\ phase = "publishing" /\ phase' = "synchronized" /\ confirmed' = TRUE
                    /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied>>
KeepCorrection == /\ phase = "publishing" /\ phase' = "retained-locally"
                  /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
Retry == /\ phase = "preserved" /\ phase' = "reading"
         /\ UNCHANGED <<relation,pending,evidence,proof,nextProof,verdict,applied,confirmed>>
Done == UNCHANGED vars
Next == ReadHead \/ NoChange \/ ApplyVerified \/ ReadMint \/ PreserveOnFailure \/ Reconcile
        \/ PublishCorrection \/ AcceptCorrection \/ KeepCorrection \/ Retry \/ Done
NoLostJournal == applied /\ pending => evidence
NoLostProof == nextProof = "removed" => proof # "journal" /\ verdict = "spent"
CorrectionNeedsAcceptance == phase = "synchronized" /\ verdict # "none" => confirmed
====
