---- MODULE ReleaseFixtures ----
EXTENDS Naturals, Sequences, FiniteSets
VARIABLE s
Init == \E init_event \in {"main","manual","pr"}: s = [event |-> init_event, release |-> "queued", fixture |-> "down", verified |-> FALSE]
BuildAndSmokePass == /\ s.release = "queued"
                     /\ s' = [s EXCEPT !.release = "built"]
CheckFails == /\ s.release = "queued"
              /\ s' = [s EXCEPT !.release = "failed"]
Upload == /\ s.release = "built" /\ s.event # "pr"
          /\ s' = [s EXCEPT !.release = "uploaded"]
Deploy == /\ s.release = "uploaded"
          /\ s' = [s EXCEPT !.release = "deployed"]
ComposeUp == /\ s.fixture = "down"
             /\ s' = [s EXCEPT !.fixture = "starting"]
HealthOK == /\ s.fixture = "starting"
            /\ s' = [s EXCEPT !.fixture = "healthy"]
ReadinessFails == /\ s.fixture \in {"starting","healthy"}
                  /\ s' = [s EXCEPT !.fixture = "failed"]
ContractOK == /\ s.fixture = "healthy"
              /\ s' = [s EXCEPT !.fixture = "ready", !.verified = TRUE]
ComposeDown == /\ s.fixture # "down"
               /\ s' = [s EXCEPT !.fixture = "down", !.verified = FALSE]
Done == UNCHANGED s
Next ==
  \/ BuildAndSmokePass
  \/ CheckFails
  \/ Upload
  \/ Deploy
  \/ ComposeUp
  \/ HealthOK
  \/ ReadinessFails
  \/ ContractOK
  \/ ComposeDown
  \/ Done
PullRequestNeverDeploys == s.event = "pr" => s.release # "deployed"
FixtureNeedsCapabilityCheck == s.fixture = "ready" => s.verified
====
