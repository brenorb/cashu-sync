---- MODULE LocalPersistence ----
EXTENDS Naturals, Sequences, FiniteSets
VARIABLE s
Init == s = [cursor |-> 0, allocations |-> <<>>, legacy |-> "present", head |-> 0, rows |-> 0, phase |-> "idle"]
Reserve == /\ s.cursor < 3 /\ Len(s.allocations) < 2
           /\ s' = [s EXCEPT !.allocations = Append(@, s.cursor), !.cursor = @ + 1]
MigrateLegacy == /\ s.legacy = "present"
                 /\ s' = [s EXCEPT !.legacy = "committed", !.cursor = IF @ < 1 THEN 1 ELSE @]
RemoveLegacyKey == /\ s.legacy = "committed"
                   /\ s' = [s EXCEPT !.legacy = "removed"]
BeginApply == /\ s.phase = "idle" /\ s.head = 0
              /\ s' = [s EXCEPT !.phase = "applying"]
RollbackApply == /\ s.phase = "applying"
                 /\ s' = [s EXCEPT !.phase = "idle"]
CommitApply == /\ s.phase = "applying"
               /\ s' = [s EXCEPT !.phase = "idle", !.head = 1, !.rows = 1, !.cursor = IF @ < 2 THEN 2 ELSE @]
ResetIdentity == /\ s.phase = "idle" /\ s.legacy = "removed"
                 /\ s' = [s EXCEPT !.cursor = 0, !.head = 0, !.rows = 0, !.allocations = <<>>]
Done == UNCHANGED s
Next ==
  \/ Reserve
  \/ MigrateLegacy
  \/ RemoveLegacyKey
  \/ BeginApply
  \/ RollbackApply
  \/ CommitApply
  \/ ResetIdentity
  \/ Done
NoReusedCounter == Len(s.allocations) = 2 => s.allocations[1] < s.allocations[2]
CursorsNeverForgetAllocations == \A i \in 1..Len(s.allocations): s.allocations[i] < s.cursor
HeadAndRowsCommitTogether == s.head = s.rows
====
