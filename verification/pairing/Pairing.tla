---- MODULE Pairing ----
VARIABLES host, join, imported, confirmed, cause, funded
vars == <<host,join,imported,confirmed,cause,funded>>
Init == /\ host = "idle" /\ join = "idle" /\ imported = FALSE /\ confirmed = FALSE
        /\ cause = "none" /\ funded \in BOOLEAN
CreateQR == /\ host = "idle" /\ host' = "qr"
            /\ UNCHANGED <<join,imported,confirmed,cause,funded>>
OpenQR == /\ host = "qr" /\ join = "idle" /\ join' = "waiting"
          /\ UNCHANGED <<host,imported,confirmed,cause,funded>>
BadQR == /\ join = "idle" /\ join' = "failed"
         /\ UNCHANGED <<host,imported,confirmed,cause,funded>>
ServeAuthority == /\ host = "qr" /\ join = "waiting"
                  /\ host' = "wait-ack" /\ join' = "importing"
                  /\ UNCHANGED <<imported,confirmed,cause,funded>>
Import == /\ join = "importing" /\ ~funded
          /\ join' = "paired" /\ imported' = TRUE /\ UNCHANGED <<host,confirmed,cause,funded>>
RefuseReplacement == /\ join = "importing" /\ funded /\ join' = "preserved"
                     /\ UNCHANGED <<host,imported,confirmed,cause,funded>>
CancelReplacement == /\ join = "preserved" /\ join' = "cancelled"
                     /\ UNCHANGED <<host,imported,confirmed,cause,funded>>
Ack == /\ host = "wait-ack" /\ join \in {"paired","preserved","cancelled"}
       /\ host' = "success" /\ confirmed' = TRUE /\ cause' = "ack"
       /\ UNCHANGED <<join,imported,funded>>
HeadAdvance == /\ host \in {"qr","wait-ack"}
               /\ host' = "success" /\ cause' = "head"
               /\ UNCHANGED <<join,imported,confirmed,funded>>
Timeout == /\ join = "waiting" /\ join' = "failed"
           /\ UNCHANGED <<host,imported,confirmed,cause,funded>>
CloseHost == /\ host \in {"qr","wait-ack"} /\ host' = "closed"
             /\ UNCHANGED <<join,imported,confirmed,cause,funded>>
Done == UNCHANGED vars
Next == CreateQR \/ OpenQR \/ BadQR \/ ServeAuthority \/ Import \/ RefuseReplacement
        \/ CancelReplacement \/ Ack \/ HeadAdvance \/ Timeout \/ CloseHost \/ Done
FundedWalletPreserved == funded => ~imported
AckMeansImported == confirmed => imported
HeadSuccessMeansImported == cause = "head" => imported
====
