---- MODULE AuthorityRecovery ----
VARIABLES phase, localData, remembered, pending, changed, checkpoint, backedUp
vars == <<phase,localData,remembered,pending,changed,checkpoint,backedUp>>
Init == /\ phase = "wallet" /\ localData \in BOOLEAN /\ remembered \in BOOLEAN
        /\ pending \in IF localData THEN BOOLEAN ELSE {FALSE}
        /\ changed = FALSE /\ checkpoint = "original" /\ backedUp = FALSE
Download == /\ phase = "wallet" /\ phase' = "downloaded"
            /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
OpenBackup == /\ phase \in {"wallet","downloaded","rejected"} /\ phase' = "decrypt"
              /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
BadPassphrase == /\ phase = "decrypt" /\ phase' = "rejected"
                 /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
SameAuthority == /\ phase = "decrypt" /\ phase' = "starting"
                 /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
DifferentFunded == /\ phase = "decrypt" /\ localData /\ phase' = "rejected"
                   /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
DifferentEmpty == /\ phase = "decrypt" /\ ~localData /\ phase' = "checking-mint"
                  /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
MintUnavailable == /\ phase = "checking-mint" /\ phase' = "rejected"
                   /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
ResetEmptyWallet == /\ phase = "checking-mint" /\ phase' = "reset"
                    /\ checkpoint' = "empty"
                    /\ UNCHANGED <<localData,remembered,pending,changed,backedUp>>
ImportAuthority == /\ phase = "reset" /\ phase' = "starting" /\ changed' = TRUE
                   /\ UNCHANGED <<localData,remembered,pending,checkpoint,backedUp>>
HeadFound == /\ phase = "starting" /\ phase' = "ready" /\ checkpoint' = "restored"
             /\ UNCHANGED <<localData,remembered,pending,changed,backedUp>>
FreshGenesis == /\ phase = "starting" /\ ~remembered /\ ~pending
                /\ phase' = "ready" /\ checkpoint' = "genesis"
                /\ UNCHANGED <<localData,remembered,pending,changed,backedUp>>
FailAndRollBack == /\ phase = "starting" /\ phase' = "rejected"
                   /\ changed' = FALSE /\ checkpoint' = "original"
                   /\ UNCHANGED <<localData,remembered,pending,backedUp>>
ResumeJournal == /\ phase = "starting" /\ pending /\ phase' = "recovering"
                 /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
RequestRemoval == /\ phase = "wallet" /\ phase' = "remove"
                  /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
RetainWallet == /\ phase = "remove" /\ phase' = "rejected"
                /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint,backedUp>>
ConfirmRelayBackup == /\ phase = "remove" /\ ~pending /\ phase' = "backed-up" /\ backedUp' = TRUE
                      /\ UNCHANGED <<localData,remembered,pending,changed,checkpoint>>
EraseDevice == /\ phase = "backed-up" /\ phase' = "removed"
               /\ checkpoint' = "empty" /\ UNCHANGED <<localData,remembered,pending,changed,backedUp>>
Done == UNCHANGED vars
Next == Download \/ OpenBackup \/ BadPassphrase \/ SameAuthority \/ DifferentFunded
        \/ DifferentEmpty \/ MintUnavailable \/ ResetEmptyWallet \/ ImportAuthority
        \/ HeadFound \/ FreshGenesis \/ FailAndRollBack \/ ResumeJournal
        \/ RequestRemoval \/ RetainWallet \/ ConfirmRelayBackup \/ EraseDevice \/ Done
NeverReplaceLocalData == localData => ~changed
NeverInventRememberedGenesis == remembered => checkpoint # "genesis"
EraseOnlyAfterBackup == phase = "removed" => backedUp /\ ~pending
====
