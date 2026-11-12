---- MODULE Pairing ----
VARIABLES host, join, imported, ackSent, confirmed, headChanged, funded
vars == <<host,join,imported,ackSent,confirmed,headChanged,funded>>
Init == /\ host = "idle" /\ join = "idle"
        /\ imported = FALSE /\ ackSent = FALSE /\ confirmed = FALSE
        /\ headChanged = FALSE /\ funded \in BOOLEAN
CreateQR == /\ host = "idle" /\ host' = "qr"
            /\ UNCHANGED <<join,imported,ackSent,confirmed,headChanged,funded>>
OpenQR == /\ host = "qr" /\ join = "idle" /\ join' = "waiting"
          /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
BadQR == /\ join = "idle" /\ join' = "failed"
         /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
ServeAuthority == /\ host = "qr" /\ join = "waiting"
                  /\ host' = "wait-ack" /\ join' = "importing"
                  /\ UNCHANGED <<imported,ackSent,confirmed,headChanged,funded>>
Import == /\ join = "importing" /\ ~funded
          /\ join' = "imported" /\ imported' = TRUE
          /\ UNCHANGED <<host,ackSent,confirmed,headChanged,funded>>
RefuseReplacement == /\ join = "importing" /\ funded /\ join' = "preserved"
                     /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
ImportError == /\ join = "importing" /\ join' = "failed"
               /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
CancelReplacement == /\ join = "preserved" /\ join' = "cancelled"
                     /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
PublishAck == /\ join = "imported" /\ join' = "ack-sent" /\ ackSent' = TRUE
              /\ UNCHANGED <<host,imported,confirmed,headChanged,funded>>
AckFailure == /\ join = "imported" /\ join' = "unconfirmed"
              /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
Ack == /\ host = "wait-ack" /\ ackSent
       /\ host' = "success" /\ confirmed' = TRUE
       /\ UNCHANGED <<join,imported,ackSent,headChanged,funded>>
HeadAdvance == /\ host \in {"qr","wait-ack"} /\ ~headChanged /\ headChanged' = TRUE
               /\ UNCHANGED <<host,join,imported,ackSent,confirmed,funded>>
Timeout == /\ join = "waiting" /\ join' = "failed"
           /\ UNCHANGED <<host,imported,ackSent,confirmed,headChanged,funded>>
CloseHost == /\ host \in {"qr","wait-ack"} /\ host' = "closed"
             /\ UNCHANGED <<join,imported,ackSent,confirmed,headChanged,funded>>
Done == UNCHANGED vars
Next == CreateQR \/ OpenQR \/ BadQR \/ ServeAuthority \/ Import \/ RefuseReplacement
        \/ ImportError \/ CancelReplacement \/ PublishAck \/ AckFailure \/ Ack
        \/ HeadAdvance \/ Timeout \/ CloseHost \/ Done
FundedWalletPreserved == funded => ~imported
AckMeansImported == ackSent => imported
HeadSuccessMeansImported == host = "success" => confirmed /\ imported
====
