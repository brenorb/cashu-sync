---- MODULE SnapshotRelay ----
EXTENDS Naturals, Sequences, FiniteSets
VARIABLE s
Init == \E init_authorized \in BOOLEAN: s = [head |-> "base", history |-> <<"base">>, winners |-> {}, budget |-> 0, authorized |-> init_authorized]
AcceptA == /\ s.authorized /\ s.head = "base" /\ s.budget < 2
           /\ s' = [s EXCEPT !.head = "a", !.history = Append(@, "a"), !.winners = @ \cup {"a"}, !.budget = @ + 1]
AcceptB == /\ s.authorized /\ s.head = "base" /\ s.budget < 2
           /\ s' = [s EXCEPT !.head = "b", !.history = Append(@, "b"), !.winners = @ \cup {"b"}, !.budget = @ + 1]
AcceptChild == /\ s.authorized /\ s.head \in {"a","b"} /\ s.budget < 2
               /\ s' = [s EXCEPT !.head = "child", !.history = <<s.head, "child">>, !.budget = @ + 1]
WindowRolls == /\ s.budget > 0
               /\ s' = [s EXCEPT !.budget = 0]
Done == UNCHANGED s
Next ==
  \/ AcceptA
  \/ AcceptB
  \/ AcceptChild
  \/ WindowRolls
  \/ Done
OneWinnerForParent == Cardinality(s.winners) <= 1
HeadRetained == Len(s.history) <= 2 /\ s.history[Len(s.history)] = s.head
UnadmittedWriterCannotAdvance == ~s.authorized => s.head = "base"
BudgetBound == s.budget <= 2
====
