---- MODULE WalletPayments ----
VARIABLES phase, kind, result, localQuote, payment
vars == <<phase,kind,result,localQuote,payment>>
Init == /\ phase = "wallet" /\ kind \in {"buy","spend"}
        /\ result = "none" /\ localQuote = FALSE /\ payment = "none"
EnterAmount == /\ phase = "wallet" /\ phase' = "amount"
               /\ UNCHANGED <<kind,result,localQuote,payment>>
RequestQuote == /\ phase = "amount" /\ phase' = "requesting"
                /\ UNCHANGED <<kind,result,localQuote,payment>>
QuoteError == /\ phase = "requesting" /\ phase' = "amount"
              /\ UNCHANGED <<kind,result,localQuote,payment>>
StoreQuote == /\ phase = "requesting" /\ phase' = "stored" /\ localQuote' = TRUE
              /\ payment' = "unpaid" /\ UNCHANGED <<kind,result>>
RejectQuote == /\ phase = "stored" /\ phase' = "amount" /\ localQuote' = FALSE
               /\ payment' = "none" /\ UNCHANGED <<kind,result>>
AmbiguousQuote == /\ phase = "stored" /\ phase' = "quote-recovery"
                  /\ UNCHANGED <<kind,result,localQuote,payment>>
ShowQuote == /\ phase = "stored" /\ phase' = "quote"
             /\ UNCHANGED <<kind,result,localQuote,payment>>
InvoicePaid == /\ phase = "quote" /\ kind = "buy" /\ payment = "unpaid"
               /\ phase' = "claimable" /\ payment' = "paid"
               /\ UNCHANGED <<kind,result,localQuote>>
Confirm == /\ (phase = "quote" /\ kind = "spend") \/ phase = "claimable"
           /\ phase' = "settling" /\ UNCHANGED <<kind,result,localQuote,payment>>
WaitForRecovery == /\ phase = "settling" /\ phase' = "recovery"
                   /\ UNCHANGED <<kind,result,localQuote,payment>>
FinishOtherQuote == /\ phase \in {"settling","recovery"}
                    /\ phase' = IF kind = "buy" THEN "claimable" ELSE "quote"
                    /\ UNCHANGED <<kind,result,localQuote,payment>>
RecordPaid == /\ phase \in {"settling","recovery"} /\ phase' = "final"
              /\ result' = "completed" /\ payment' = "paid" /\ UNCHANGED <<kind,localQuote>>
RecordUnpaid == /\ phase \in {"settling","recovery"} /\ kind = "spend"
                /\ phase' = "final" /\ result' = "completed" /\ payment' = "unpaid"
                /\ UNCHANGED <<kind,localQuote>>
DisplaySuccess == /\ phase = "final" /\ result = "completed" /\ payment = "paid"
                  /\ phase' = "success" /\ UNCHANGED <<kind,result,localQuote,payment>>
DisplayUnpaid == /\ phase = "final" /\ kind = "spend" /\ payment = "unpaid"
                 /\ phase' = "unpaid" /\ UNCHANGED <<kind,result,localQuote,payment>>
RetrySpend == /\ phase = "unpaid" /\ phase' = "quote"
              /\ UNCHANGED <<kind,result,localQuote,payment>>
Done == UNCHANGED vars
Next == EnterAmount \/ RequestQuote \/ QuoteError \/ StoreQuote \/ RejectQuote
        \/ AmbiguousQuote \/ ShowQuote \/ InvoicePaid \/ Confirm \/ WaitForRecovery
        \/ FinishOtherQuote \/ RecordPaid \/ RecordUnpaid \/ DisplaySuccess \/ DisplayUnpaid \/ RetrySpend \/ Done
QuoteBackedByLocalRecord == phase \in {"quote","claimable","settling","recovery","final","unpaid","success"} => localQuote
SuccessMeansPaid == phase = "success" => payment = "paid"
BuyInit == Init /\ kind = "buy"
SpendInit == Init /\ kind = "spend"
====
