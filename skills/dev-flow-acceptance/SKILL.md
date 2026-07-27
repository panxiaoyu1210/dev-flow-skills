---
name: dev-flow-acceptance
description: Use when dev-flow execution is settled and the main agent must run final acceptance, collect evidence, write the delivery report, produce a phase result, or decide readiness.
---

# dev-flow-acceptance

Own final readiness and the delivery report. It verifies completed work; it does not implement fixes or bypass earlier gates. All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth. Read `../dev-flow-master/references/graph-control.md` for Master readiness and `../dev-flow-loop/references/graph-control.md` before returning a structured Loop phase result.

Apply the shared bounded-convergence rule from `../dev-flow-master/references/state-and-gates.md`; acceptance does not redefine checker thresholds or materiality.

## Steps

1. **Reconcile acceptance inputs.** Follow `references/readiness-and-report.md`; read actual Git/filesystem state, OpenSpec/opsx, orchestration, progress, task evidence, and any accepted phase handoff. Run `dev-flow graph check` and targeted `context` when a Master Graph exists.
   **Complete when:** every planned task, requirement, test, gate, evidence record, Git state, deferral, and handoff coordinate is accounted for at the current revision.

2. **Run fresh proving checks.** Execute the final and system-level matrix, verify `/opsx:verify <change>`, inspect transient evidence without promoting raw output, and use Graph `next` to expose any remaining blockers.
   **Complete when:** every required command has a fresh result or an explicit approved deferral with acceptance impact.

3. **Obtain independent judgment.** Give the independent acceptance checker raw artifacts, diff, commands, TDD evidence, and draft report without the main agent's expected conclusion. Apply bounded convergence only to material findings.
   **Complete when:** the checker satisfies policy with no P0/P1 or unresolved material finding, or returns a concrete `not-ready` route.

4. **Persist readiness.** Write the governed delivery report and aggregate `review_evidence_ready`/`acceptance_ready`. In Graph mode, transition only after all prerequisites and permissions pass; for loop-authorized work, create the schema-valid Master-to-Loop acceptance result.
   **Complete when:** report, evidence hashes/summaries, readiness state, and actual repository state agree.

5. **Return control.** Report `ready-to-report`, `ready-for-review`, or `not-ready`. A Loop phase result goes back through the accepted handoff; ordinary failures route to execution/planning. Independent CR remains separately user-triggered.
   **Complete when:** the final state names evidence, residual risk, Git status, next owner/action, and any blocked criterion without claiming more than tests prove.

## Context Pointers

- `references/readiness-and-report.md`: acceptance inputs, checks, report, checker, failure recovery, and signal.
- `../dev-flow-master/references/graph-control.md`: Master Graph readiness and completion transitions.
- `../dev-flow-loop/references/graph-control.md`: structured handoff and acceptance/phase-eval result.
- `../dev-flow-master/references/state-and-gates.md` § Bounded Convergence Policy: the single source for checker thresholds, materiality, and evaluation budget semantics.

Artifact existence, an agent report, or a passing subset of tests is never acceptance completion.
