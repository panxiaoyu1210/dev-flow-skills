# Loop Graph Control Reference

Use this reference for a delivery Loop with machine-governed baseline, phase DAG, envelope, budget, eval, repair, or structured handoff. `schemas/v1/**` and `lib/graph/**` own fields and semantics; this file explains Loop execution.

## Authority and Isolation

Legacy, Shadow, and Graph modes use the common one-writer authority contract in `dev-flow-master/references/graph-control.md`. The formal Loop Graph path is `Docs/<topic>/loop/loop-graph.json`; its generated view is `Docs/<topic>/loop/loop-graph.md`. Raw events and transient evidence stay under `.dev-flow/runtime/<run-id>/`.

The Loop Graph controls Goal/Baseline/Phase/Envelope/Budget/Eval only. The Master Graph controls Requirement/Task/Test/Gate/Evidence/Git/Failure only. Each has its own revision, event references, permissions, validation, and authority. Loop does not create or schedule Master Tasks; Master does not change the Loop Baseline.

## Loop Command Sequence

1. Run `dev-flow graph check --graph Docs/<topic>/loop/loop-graph.json --json`.
   Completion: authority, schema, phase DAG, references, controls, evidence, and permissions validate.
2. Run `dev-flow graph next --graph <loop-path> --json`, then targeted `context` for the selected phase/control.
   Completion: the next phase is eligible and every baseline, envelope, budget, eval, or dependency blocker is explicit.
3. Preview `dev-flow graph impact` for baseline, artifact, file, or phase-related changes. Use `--apply` only in Graph mode.
   Completion: stale propagation and route distinguish phase repair, Master replan, Loop Baseline change, and `unknown_impact`.
4. Use `transition` only after the real checker/user/eval action.
   Completion: the event and new revision persist atomically at their individual state boundaries, or the old Graph remains authoritative and the command returns a machine-readable failure.

Legacy keeps Markdown authoritative. Shadow requires the explicit fenced projection contract in the Master Graph reference, remains read-only, and blocks on projection errors or drift. Graph keeps the Loop Graph authoritative and emits a Markdown view. Graph mode must not read that generated Markdown view back into control authority.

## Structured Phase Handoff

The handoff is Loop-to-Master only. Use the exported `createPhaseHandoff` and `acceptPhaseHandoff` APIs; the versioned phase-handoff schema is the field authority.

Issue a handoff only when:

- the selected phase is ready and returned as eligible;
- the Loop Baseline is confirmed;
- the envelope is approved for phase handoff and auto-continue;
- budget is live;
- phase, baseline, envelope, budget, requirement, artifact, and both Graph coordinates are bound by stable references/hashes.

Completion: both API calls accept the same handoff against current Loop and Master Graphs, and Master contains the exact accepted-handoff receipt. Always `await` handoff/result APIs; Shadow calls reread current Markdown at entry using `sourceRoot`, or separate `loopSourceRoot` and `masterSourceRoot`. In Graph mode, atomically persist the new Master Graph returned by `acceptPhaseHandoff` before execution. In Shadow mode, the exact receipt must already be in the authoritative fenced projection; otherwise update Markdown and create a new one-way snapshot. If phase, baseline, envelope, budget, graph identity, revision hash, or projection changes, acceptance fails. Classify this as Loop Baseline change and reissue; never merge the drift into an old handoff.

## Acceptance and Phase Evaluation

Master acceptance creates a Master-to-Loop result with `createAcceptanceResult`. Loop verifies and consumes it with `consumePhaseResult`, then may create the loop-internal phase evaluation record with `createPhaseEvaluationResult`. The phase-result schema is authoritative.

Completion requires:

- the acceptance result is bound to the persisted handoff receipt and current graph identities;
- required Master tasks, gates, tests, Git state, failures, and fresh evidence are acceptance-ready;
- Loop budget and repair policy allow the selected action;
- the returned action is next phase, repair phase, stop for review, or stop;
- the Loop Graph transition follows the result and preserves evidence references.

A passing agent message or Markdown report cannot substitute for the structured result. `phase_eval` remains distinct from user-triggered `/dev-flow-cr`.

## Stop and Conservative Routing

Use `dev-flow graph --help` as the result/exit source of truth. Stop and route the machine-readable finding to the user/owner when baseline, envelope, budget, repair limit, evidence, permission, or handoff coordinates block progress. `unknown_impact` always blocks for conservative review, including an explicit impact request without Graph state.
