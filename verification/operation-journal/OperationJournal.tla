---- MODULE OperationJournal ----
EXTENDS Naturals, FiniteSets
VARIABLES a, b, head, remote, sent, response, kind
Devices == {"A", "B"}
vars == <<a,b,head,remote,sent,response,kind>>
Init == /\ a = "idle" /\ b = "idle" /\ head = "base"
        /\ remote = "empty" /\ sent = {} /\ response = "none"
        /\ kind \in {"mint","melt"}
Prepare == /\ a = "idle" /\ head = "base" /\ a' = "prepared"
           /\ UNCHANGED <<b,head,remote,sent,response,kind>>
PublishA == /\ a = "prepared" /\ head = "base"
            /\ a' \in {"accepted","ambiguous"} /\ head' = "A"
            /\ remote' = "prepared" /\ UNCHANGED <<b,sent,response,kind>>
ConfirmA == /\ a = "ambiguous" /\ head = "A" /\ a' = "accepted"
            /\ UNCHANGED <<b,head,remote,sent,response,kind>>
RejectBeforeSubmit == /\ a = "prepared" /\ a' = "aborted"
                      /\ UNCHANGED <<b,head,remote,sent,response,kind>>
ImportPeerPrepared == /\ b = "idle" /\ remote = "prepared" /\ head = "A"
                      /\ b' = "prepared" /\ UNCHANGED <<a,head,remote,sent,response,kind>>
PublishB == /\ b = "prepared" /\ head = "A" /\ remote = "prepared"
            /\ b' = "accepted" /\ head' = "B"
            /\ UNCHANGED <<a,remote,sent,response,kind>>
MarkA == /\ a = "accepted" /\ a' = "marked"
         /\ UNCHANGED <<b,head,remote,sent,response,kind>>
MarkB == /\ b = "accepted" /\ b' = "marked"
         /\ UNCHANGED <<a,head,remote,sent,response,kind>>
PostA == /\ a = "marked" /\ a' = "inflight" /\ sent' = sent \cup {"A"}
         /\ UNCHANGED <<b,head,remote,response,kind>>
PostB == /\ b = "marked" /\ b' = "inflight" /\ sent' = sent \cup {"B"}
         /\ UNCHANGED <<a,head,remote,response,kind>>
LoseResponse == /\ a \in {"marked","inflight"} /\ a' = "recovering"
                /\ UNCHANGED <<b,head,remote,sent,response,kind>>
RecordResponse == /\ a \in {"inflight","recovering","pending"}
                  /\ a' = "recorded"
                  /\ response' \in IF kind = "mint" THEN {"issued"} ELSE {"paid","unpaid","pending"}
                  /\ UNCHANGED <<b,head,remote,sent,kind>>
KeepPending == /\ a = "recorded" /\ response = "pending" /\ a' = "pending"
               /\ UNCHANGED <<b,head,remote,sent,response,kind>>
FinalCAS == /\ a = "recorded" /\ head = "A" /\ response \in {"issued","paid","unpaid"}
            /\ a' = "final-accepted" /\ remote' = "final"
            /\ UNCHANGED <<b,head,sent,response,kind>>
ApplyFinal == /\ a = "final-accepted" /\ a' = "done"
              /\ UNCHANGED <<b,head,remote,sent,response,kind>>
Done == UNCHANGED vars
Next == Prepare \/ PublishA \/ ConfirmA \/ RejectBeforeSubmit \/ ImportPeerPrepared
        \/ PublishB \/ MarkA \/ MarkB \/ PostA \/ PostB \/ LoseResponse
        \/ RecordResponse \/ KeepPending \/ FinalCAS \/ ApplyFinal \/ Done
DurableBeforeFirstPost == /\ ("A" \in sent => a \in {"inflight","recovering","recorded","pending","final-accepted","done"})
                         /\ ("B" \in sent => b = "inflight")
OneInitialPostPerOperation == Cardinality(sent) <= 1
OnlyTerminalClears == a = "done" => response \in {"issued","paid","unpaid"}
====
