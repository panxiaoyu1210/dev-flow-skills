---
description: Run or inspect Loop Engineering control, loop-only baseline artifacts, phase DAG, envelope, triage, eval, and safe handoff through dev-flow-loop.
---

# Dev Flow Loop

Use this command as the slash-command entrypoint for Loop Engineering around Dev Flow.

## Workflow

1. Use the `dev-flow-loop` skill as the owner.
2. Treat the argument after `/dev-flow-loop` as the loop scope or question.
3. Load `references/control-plane.md` through the owner skill before delivery-loop design, Loop Phase DAG work, automation proposal, or `loop_control_ready`.
4. Resolve authority: when `Docs/<topic>/loop/loop-graph.json` exists, run `dev-flow graph check`, `next`, and targeted `context`; otherwise retain Legacy Markdown. Shadow is explicit opt-in through a fenced `dev-flow-graph` projection. Keep Loop Graph and Master Graph isolated.
5. Identify scope, trigger type, trace_or_eval_evidence, and maker-checker separation before any route or execution recommendation.
6. For delivery loops, require Baseline Docs Gate before implementation: loop-only requirements, high-level design, detailed design, test plan (`test-plan.md`), and test case workbook (`test-cases.xlsx`) artifacts reviewed by a checker subagent with `checker_score` recorded. Apply bounded convergence with quality target: 95 and convergence floor: 90. These are outer-loop control artifacts, not `/dev-flow` implementation documents.
7. Require Execution Envelope Gate before phase handoff: Loop Phase DAG, `auto_continue_scope`, `dev_flow_phase_handoff`, budgets, stop conditions, and side-effect boundaries. Before the gate, spawn a checker subagent to score the DAG and Envelope against the `DAG and Envelope Quality Checklist`; record `dag_envelope_checker_score` and apply bounded convergence.
8. Persist delivery-loop control artifacts locally by authority mode: Legacy writes the approved `loop-state.md` and related Markdown under `Docs/<topic>/loop/`; Shadow writes its fenced Markdown projection source there and creates a new snapshot; Graph writes control facts through the Loop Graph CLI/API and only then refreshes the Markdown evidence views. Keep OpenSpec/opsx originals in `openspec/changes/<change-id>/` or their standard project location.
9. Maintain `phase-artifacts.md` or `opsx-index.md` as the phase artifact index. Do not move or copy OpenSpec/opsx originals into the loop artifact directory.
10. Only after both gates are approved, issue a versioned structured phase handoff and let phase-level dev-flow auto-continue within baseline. Loop selects phases but never schedules Master-internal Tasks. Before starting execution, verify `openspec_artifact_ready.checker_score` and `task_orchestration_ready.checker_score` satisfy dev-flow-planning bounded convergence. Phase execution must provide phase-level OpenSpec/opsx, TDD per task via superpowers or equivalent fallback, detailed test matrix, system-level acceptance evidence, and `phase_eval` with `phase_eval_result.checker_score`, no P0/P1 finding, and no unresolved material finding.
11. Consume the bound Master acceptance result before phase eval; use Graph `impact` for control changes and treat `unknown_impact` as a conservative Loop Baseline review.
12. Load `dev-flow-loop-envelope` before repeated, scheduled, background, persistent, or auto-continuing loops. If `loop_envelope_ready` is blocked, present the blocker and stop.
13. Load `dev-flow-loop-triage` when scanning repo, CI, diff, OpenSpec/opsx, issue, PR, or dev-flow artifacts.
14. Emit `loop_baseline_ready` and `loop_control_ready` per the owner skill schemas.
15. When recommending `/dev-flow`, `/dev-flow-cr`, or `/dev-flow-scheduler` from triage, ask a concrete handoff question; after explicit confirmation of a specific candidate, enter the equivalent owner flow without requiring another slash command.

## Rules

- Default read-only.
- For any recurring, scheduled, or persistent loop proposal, `dev-flow-loop-envelope` is mandatory before emitting a route recommendation to `/dev-flow-scheduler`. No budget ceiling = no automation proposal.
- Do not start `/dev-flow` automatically from unconfirmed triage candidates.
- Do not start `/dev-flow-cr` automatically from unconfirmed triage candidates.
- After Baseline Docs Gate and Execution Envelope Gate are both approved, phase-level dev-flow handoff may auto-continue within baseline.
- Freezing the initial baseline, approving the Loop Phase DAG, and enabling `within_confirmed_baseline` require explicit user approval; exceeding baseline, budget, retry, stop-condition, or side-effect boundaries requires stopping and asking the user.
- Do not start commits, pushes, PRs, merges, worktrees, schedulers, or external mutations automatically.
- Do not create, update, pause, resume, or delete schedulers/automations; route those actions to `dev-flow-scheduler`.
- Do not emit dev-flow delivery-stage signals such as `routing_decided`, `execution_settled`, `acceptance_ready`, or `cr_report_ready`.
- Persist delivery-loop baseline/state/DAG/envelope/index artifacts under the approved loop artifact directory; for read-only triage or workflow design, persist reports only when the user explicitly asks.
- Treat canonical loop documents as Git-tracked formal artifacts; keep raw checker/test/runtime output under `.dev-flow/runtime/<run-id>/`, apply the local `.git/info/exclude` policy through `dev-flow-git`, and stage through its staging allowlist; do not use `git add -A` or `git add .`.
- Keep trace/eval evidence in the loop report or reply; keep loop state separate from `dev-flow-state.md`.
- Use configurable `max_checker_evaluations` as the per-checkpoint upper budget; it defaults to 3. Do not consume the budget for a non-material finding or YAML-only key ordering, formatting, equivalent wording, or unconsumed field naming, and do not increase it without explicit user approval.
- `schemas/v1/**` and the Graph CLI/library are the machine-rule source of truth. Legacy is Markdown authority, Shadow is one-way Markdown-to-Graph, and Graph is one-way Graph-to-Markdown-view.
- A Graph transition follows real approval/evidence. `unknown_impact`, including an explicit impact request without Graph state, blocks for conservative routing. Use `dev-flow graph --help` for result meanings; no failure is silently repaired.

## User Request

Apply the Loop Engineering control workflow above to the user's current request and any arguments supplied after `/dev-flow-loop`.
