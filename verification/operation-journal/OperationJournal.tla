---- MODULE OperationJournal ----
EXTENDS Naturals, FiniteSets
VARIABLES phase, relay, owner, durable, sent, response, kind
Devices == {"A", "B"}
vars == <<phase, relay, owner, durable, sent, response, kind>>
Init == /\ phase = [d \in Devices |-> "idle"]
        /\ relay \in {"empty", "legacy-prepared"}
        /\ owner = "none" /\ durable = {} /\ sent = {}
        /\ response = "none" /\ kind \in {"mint","melt"}

Prepare(d) == /\ phase[d] = "idle" /\ relay \in {"empty","legacy-prepared"}
              /\ phase' = [phase EXCEPT ![d] = "prepared"]
              /\ UNCHANGED <<relay,owner,durable,sent,response,kind>>
Fence(d) == /\ phase[d] = "prepared" /\ relay \in {"empty","legacy-prepared"}
            /\ relay' = "submitted" /\ owner' = d
            /\ \E receipt \in {"direct","lost"}:
                phase' = [phase EXCEPT ![d] = receipt]
            /\ UNCHANGED <<durable,sent,response,kind>>
LoseCAS(d) == /\ phase[d] = "prepared" /\ relay \in {"submitted","final"}
              /\ phase' = [phase EXCEPT ![d] = "aborted"]
              /\ UNCHANGED <<relay,owner,durable,sent,response,kind>>
Reject(d) == /\ phase[d] = "prepared" /\ relay \in {"empty","legacy-prepared"}
             /\ phase' = [phase EXCEPT ![d] = "aborted"]
             /\ UNCHANGED <<relay,owner,durable,sent,response,kind>>
AcceptDirect(d) == /\ phase[d] = "direct"
                   /\ phase' = [phase EXCEPT ![d] = "can-send"]
                   /\ durable' = durable \cup {d}
                   /\ UNCHANGED <<relay,owner,sent,response,kind>>
ResumeFence(d) == /\ relay = "submitted" /\ phase[d] \in {"idle","lost","aborted"}
                  /\ phase' = [phase EXCEPT ![d] = "recovering"]
                  /\ UNCHANGED <<relay,owner,durable,sent,response,kind>>
Interrupt(d) == /\ phase[d] \in {"direct","can-send","inflight"}
                /\ phase' = [phase EXCEPT ![d] = "recovering"]
                /\ UNCHANGED <<relay,owner,durable,sent,response,kind>>
FirstPost(d) == /\ phase[d] = "can-send"
                /\ phase' = [phase EXCEPT ![d] = "inflight"]
                /\ sent' = sent \cup {d}
                /\ UNCHANGED <<relay,owner,durable,response,kind>>

\* One terminal mint result is shared across devices. Recovery abstracts
\* quote lookup, exact replay under mint rules, and exact-output restore.
ObserveResult(d) == /\ phase[d] \in {"inflight","recovering","pending"}
                    /\ relay = "submitted"
                    /\ response' \in IF response \in {"paid","unpaid","issued"}
                                     THEN {response}
                                     ELSE IF kind = "mint" THEN {"issued"}
                                     ELSE {"paid","unpaid","pending"}
                    /\ phase' = [phase EXCEPT ![d] =
                            IF response' = "pending" THEN "pending" ELSE "recorded"]
                    /\ UNCHANGED <<relay,owner,durable,sent,kind>>
FinalCAS(d) == /\ phase[d] = "recorded" /\ relay = "submitted"
               /\ response \in {"issued","paid","unpaid"}
               /\ relay' = "final"
               /\ phase' = [phase EXCEPT ![d] = "final-accepted"]
               /\ UNCHANGED <<owner,durable,sent,response,kind>>
ApplyFinal(d) == /\ relay = "final" /\ phase[d] \in
                     {"idle","aborted","lost","recovering","pending","recorded","final-accepted","inflight"}
                 /\ phase' = [phase EXCEPT ![d] = "done"]
                 /\ UNCHANGED <<relay,owner,durable,sent,response,kind>>
Done == UNCHANGED vars
PreparePayment == \E d \in Devices: Prepare(d)
ClaimPayment == \E d \in Devices: Fence(d)
LoseClaim == \E d \in Devices: LoseCAS(d)
RejectPayment == \E d \in Devices: Reject(d)
AcceptClaim == \E d \in Devices: AcceptDirect(d)
RecoverClaim == \E d \in Devices: ResumeFence(d)
InterruptPayment == \E d \in Devices: Interrupt(d)
SendPayment == \E d \in Devices: FirstPost(d)
ReadMintResult == \E d \in Devices: ObserveResult(d)
SaveFinal == \E d \in Devices: FinalCAS(d)
ReadFinal == \E d \in Devices: ApplyFinal(d)
Next == PreparePayment \/ ClaimPayment \/ LoseClaim \/ RejectPayment \/ AcceptClaim
        \/ RecoverClaim \/ InterruptPayment \/ SendPayment \/ ReadMintResult
        \/ SaveFinal \/ ReadFinal \/ Done
DurableBeforeFirstPost == /\ sent \subseteq durable
                         /\ \A d \in sent: d = owner
OneInitialPostPerOperation == Cardinality(sent) <= 1
OnlyTerminalClears == relay = "final" => response \in {"issued","paid","unpaid"}
ChartInit == Init /\ relay = "empty" /\ kind = "melt"
ClaimPaymentForChart == Fence("A")
ChartNext == PreparePayment \/ ClaimPaymentForChart \/ LoseClaim \/ RejectPayment
             \/ AcceptClaim \/ RecoverClaim \/ InterruptPayment \/ SendPayment
             \/ ReadMintResult \/ SaveFinal \/ ReadFinal \/ Done
====
