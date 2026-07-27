---
name: dev-flow-planning
description: Use when dev-flow needs OpenSpec/opsx baseline artifacts, independent checker review, task orchestration, DAG batches, detailed tests, Git safety preparation, or an executable test matrix.
---

# dev-flow-planning

Own governed planning before execution. It produces persisted planning signals and artifacts; it does not execute tasks or make runtime/Git decisions. All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth. OpenSpec/opsx remains authoritative for requirement and design prose. Read `../dev-flow-master/references/graph-control.md` when planning has Graph state; the Skill never duplicates node fields, edge rules, or transition tables.

## Steps

1. **Recover planning inputs.** Read actual project state, OpenSpec/opsx, `dev-flow-state.md`, and any accepted Loop handoff. Run `dev-flow graph check` and targeted `context` when a Master Graph exists; use Legacy Markdown when it does not.
   **Complete when:** authority, scope, open questions, accepted assumptions, current approvals, and stale evidence are reconciled.

2. **Clear the pre-artifact gate.** Follow `references/pre-documentation-gate.md`: clarify material unknowns, record assumptions, and obtain explicit artifact-start approval before writing or refreshing OpenSpec/opsx.
   **Complete when:** every blocking question is answered, explicitly accepted as risk, or persisted as a paused gate, and `documentation_start_approved` records the user's decision.

3. **Build the OpenSpec baseline.** Follow `references/phase-1-documents.md`; in loop-authorized mode, reference the confirmed Loop baseline and create only phase-level OpenSpec/opsx. Apply the shared bounded-convergence rule from `../dev-flow-master/references/state-and-gates.md`.
   **Complete when:** artifacts exist, objective sufficiency checks pass, material findings are resolved or explicitly routed, and `openspec_artifact_ready` is persisted.

4. **Build phase orchestration.** Follow `references/task-orchestration.md` to map requirements to a cycle-free phase-internal task DAG, overlap-safe batches, TDD entries, final/system checks, and Git assumptions. Use `dev-flow graph impact` to preview changed control references; in Graph mode apply stale propagation before rebuilding downstream readiness.
   **Complete when:** every requirement and acceptance item maps to at least one task and check, every task has a checkable done condition, and the independent orchestration checker supports `task_orchestration_ready`.

5. **Present the next gate.** Load `dev-flow-git`, reconcile `git_safe`, and use Graph `next`/`context` when available. Planning proposes evidence; only the owning gate records a transition.
   **Complete when:** Phase 2 presentation names task/batch counts, overlap constraints, executable checks, execution actor, Git boundary, checker result, blockers, and the exact approval requested.

## Context Pointers

- `references/pre-documentation-gate.md`: clarification and artifact-start approval.
- `references/phase-1-documents.md`: OpenSpec baseline, checker policy, and loop phase slicing.
- `references/task-orchestration.md`: task schema, DAG, batches, tests, and automation readiness.
- `../dev-flow-master/references/graph-control.md`: Master Graph authority, commands, impact, context, and transitions.
- `../dev-flow-master/references/state-and-gates.md` § Bounded Convergence Policy: the single source for checker thresholds, materiality, and evaluation budget semantics.

Completion means all five steps meet their **Complete when:** criteria; artifact existence alone is not planning readiness.
