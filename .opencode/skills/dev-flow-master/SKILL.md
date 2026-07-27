---
name: dev-flow-master
description: Use as the primary entrypoint for dev-flow development requests, including features, debugging, UI/UX, review, requirement changes, recovery, governed routing, phase gates, execution coordination, Git boundaries, and acceptance.
---

# dev-flow-master

Dispatch governed dev-flow work. Master owns route and gate decisions; focused skills own their stages. It coordinates implementation but does not implement, perform Git side effects, or replace OpenSpec/opsx.

All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth. This Skill retains invocation, ordered action, completion criteria, and context pointers; it does not restate graph fields, state vocabularies, or transition tables.

Graph support is optional per project. Legacy keeps Markdown authoritative. Shadow is explicit opt-in through a fenced `dev-flow-graph` projection and derives a read-only snapshot. Graph makes the Graph authoritative and Markdown a generated view. Read `references/graph-control.md` before selecting a mode, querying routing/readiness, changing graph state, or accepting a Loop phase handoff.

## Steps

1. **Recover authority and evidence.** Inspect actual Git/filesystem state and persisted OpenSpec/dev-flow artifacts. If a Graph exists, run `dev-flow graph check --graph <path> --json`, then `next` and targeted `context`; otherwise continue the Legacy Markdown path.
   **Complete when:** the active authority mode, state path, current blockers, and evidence revision are known without relying on chat memory.

2. **Classify and route.** Load `dev-flow-intent` for every new or ambiguous entry, check existing change/spec context, classify complexity, and emit persisted `routing_decided`. A valid loop-authorized phase handoff enters planning with its confirmed loop baseline and envelope instead of rebuilding the global baseline.
   **Complete when:** one owner, one implementation path, required protocols, risks, and the next gate are explicit and persisted.

3. **Drive planning gates.** Route implementation work through OpenSpec/opsx; use `dev-flow-planning` for medium/heavy work and `dev-flow-git` before Phase 2. In Graph mode, use `next`/`context` for eligibility and `transition` only after the owning evidence and required user/checker approval exist.
   **Complete when:** OpenSpec Baseline and Phase 2 are either verifiably passed or have a machine-readable blocker and recovery owner.

4. **Coordinate execution.** After Phase 2, load `dev-flow-execution` and continue to settlement. On requirement, artifact, file, or task changes, preview `dev-flow graph impact`; apply typed stale propagation only in Graph mode. Treat `unknown_impact` as conservative replanning, never as no impact.
   **Complete when:** all in-scope tasks have final reviewed outcomes, evidence summaries, and permitted Git integration states.

5. **Authorize completion.** Load `dev-flow-acceptance`, reconcile fresh tests/evidence with the current authority, and query Graph readiness when present. A gate or completion transition follows evidence; it never substitutes for evidence.
   **Complete when:** `acceptance_ready` supports `ready-to-report`, or the result is explicitly `not-ready`/`ready-for-review` with owner, reason, and next action.

## Context Pointers

- `references/routing-and-complexity.md`: owner selection, complexity, OpenSpec/opsx, and loop-authorized entry.
- `references/state-and-gates.md`: persisted signals, approvals, ownership, and completion evidence.
- `references/flow-and-recovery.md`: stage order, recovery, continuation, and hard stops.
- `references/graph-control.md`: authority modes, Graph command sequence, conservative impact, transitions, and handoff boundary.

OpenSpec/opsx remains the requirements/design body. The Master Graph stores only stable control references and summaries. Loop and Master Graphs remain isolated; Master never changes the Loop Baseline.
