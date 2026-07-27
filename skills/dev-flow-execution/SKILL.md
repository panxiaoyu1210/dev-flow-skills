---
name: dev-flow-execution
description: Use when Phase 3 has started and dev-flow must execute continuously, dispatch and review tasks, replan safely, verify results, and maintain recoverable runtime state.
---

# dev-flow-execution

Own Phase 3 from approved orchestration through settlement. The main agent coordinates; implementation tasks are dispatched to sub-agents and independently reviewed. All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth. Read `../dev-flow-master/references/graph-control.md` before Graph-driven dispatch, stale propagation, or status change; operational details remain in the references below.

## Steps

1. **Reconstruct runtime truth.** Re-read actual Git/filesystem state, OpenSpec/opsx, `dev-flow-state.md`, orchestration, progress, and current Graph. Run `dev-flow graph check`, `next`, and targeted `context` when Graph state exists.
   **Complete when:** the Runtime Orchestration State agrees with persisted artifacts and actual state, and every pending/running/blocked task is accounted for.

2. **Dispatch eligible work.** Follow `references/runtime-and-dispatch.md` and the approved `git_safe` writer cap. Dispatch only tasks returned as eligible by the current DAG/Graph; keep high-overlap writers serial.
   **Complete when:** every dispatched task has satisfied dependencies, scoped context, acceptance checks, TDD expectations, reviewer contract, and permitted side effects.

3. **Settle each task.** Follow `references/task-settlement-and-modes.md`. Require observed RED, minimal GREEN, refactor verification or approved exception; then obtain an independent reviewer verdict. Record Graph `transition` only after evidence and permission are present.
   **Complete when:** each task has a final signal, reviewer resolution, fresh diagnostics/tests, evidence summary, and canonical Git integration state.

4. **Propagate change and replan.** Preview `dev-flow graph impact` for changed requirement/artifact/file/task sources. In Graph mode apply typed stale propagation; `unknown_impact` routes conservatively to Master replanning. Follow `references/replanning-and-recovery.md` for inside-baseline changes and gate re-entry.
   **Complete when:** affected nodes/tasks, DAG batches, tests, progress, and recovery owner reflect the same revision; no new dispatch uses stale context.

5. **Run to settlement.** Continue across task and batch boundaries while a safe eligible action exists. Query `next` after each material update; stop only on a documented hard-stop or transfer to acceptance after all work settles.
   **Complete when:** `execution_settled` truthfully records every task outcome, replan, TDD/local-verification evidence, test result, Git state, and unresolved blocker.

## Context Pointers

- `references/runtime-and-dispatch.md`: run-to-completion state, agent cap, and eligibility.
- `references/task-settlement-and-modes.md`: modes, final signals, TDD, reviewer, and retry protocol.
- `references/replanning-and-recovery.md`: impact classes, recovery priority, replanning, and progress.
- `../dev-flow-master/references/graph-control.md`: Master Graph queries, contexts, impact, and transitions.

A task, batch, or phase is incomplete until its proving evidence is fresh and the corresponding state is settled; an agent success message alone is not completion.
