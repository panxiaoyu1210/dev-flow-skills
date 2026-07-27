---
name: dev-flow-loop
description: Use when the user asks for Loop Engineering, goal-preserving automation, repeated or multi-round control, loop DAGs, candidate inboxes, automation guardrails, loop review, or phase handoff to dev-flow.
---

# Dev Flow Loop

Own the outer control plane: goal, confirmed baseline, cross-phase DAG, envelope, budget, eval/repair, and stop decisions. Dev-flow owns phase-internal implementation. All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth. The Loop Graph is separate from the Master Graph. Read `references/graph-control.md` before mode selection, phase eligibility, budget/eval decisions, handoff, or recovery; read `references/control-plane.md` for artifact/checker details.

Apply the shared bounded-convergence rule from `../dev-flow-master/references/state-and-gates.md`; the approved envelope supplies the Loop evaluation budget without redefining the rule.

## Boundary

Default read-only for design, review, triage, and proposals. Writing the initial baseline, freezing it, approving the Loop Phase DAG, and enabling `within_confirmed_baseline` require explicit user approval. Confirmed phases may auto-continue only inside the approved envelope.

Keep loop state separate from `dev-flow-state.md`. Formal Loop state belongs under `Docs/<topic>/loop/`; phase OpenSpec/opsx originals remain in their project location. Transient evidence belongs under `.dev-flow/runtime/<run-id>/`.

Do not start `/dev-flow` or `/dev-flow-cr` from an unconfirmed triage item. Scheduler mutations belong to `dev-flow-scheduler`; Git/external/paid effects remain approval-bound.

## Steps

1. **Recover scope and authority.** Classify workflow design, triage, run review, automation proposal, dispatch handoff, or delivery loop. Run `dev-flow graph check`, `next`, and targeted `context` when a Loop Graph exists; otherwise follow Legacy Markdown.
   **Complete when:** goal, trigger, evidence, authority mode, current baseline/envelope, budget, and side-effect boundary are known.

2. **Establish the baseline.** For delivery loops, discuss goal, requirements, blockers, non-goals, design options, and success evidence; then obtain current-turn approval before writing loop-only baseline artifacts. Use an independent checker and Baseline Docs Gate.
   **Complete when:** the full baseline set is checker-reviewed, material findings are resolved/routed, user approval is persisted, and `loop_baseline_ready` is truthful.

3. **Govern the phase DAG and envelope.** Create the Loop Phase DAG, load `dev-flow-loop-envelope`, and independently check DAG/envelope quality. The Loop Graph may control Goal/Baseline/Phase/Envelope/Budget/Eval only.
   **Complete when:** phases are acyclic and covered, entry/exit/repair criteria are checkable, controls are approved, and `loop_control_ready` plus `loop_envelope_ready` agree.

4. **Hand off one eligible phase.** Use Loop Graph `next`/`context`; issue the structured phase handoff only for a ready phase inside the confirmed baseline with live envelope and budget. Loop does not schedule Master-internal Tasks, and Master does not modify Loop Baseline.
   **Complete when:** the handoff validates against the versioned contract and binds both graph identities, phase, baseline, envelope, budget, and stable references.

5. **Evaluate and continue.** Consume the Master acceptance result, run independent `phase_eval`, preview/apply typed impact for loop control changes, and choose next phase, inside-baseline repair, or stop. Treat `unknown_impact` conservatively.
   **Complete when:** phase result, checker evidence, budget/repair counters, next owner/action, and Loop Graph transition agree; final completion also has `loop_eval_result`.

6. **Route adjacent branches.** Load `dev-flow-loop-triage` for Candidate Inbox work and `dev-flow-scheduler` only after an approved automation request.
   **Complete when:** the output is read-only evidence or a concrete confirmation question; no implementation or scheduler side effect was inferred.

## Context Pointers

- `references/control-plane.md`: baseline assets, checker gates, DAG/envelope checklist, signals, and reports.
- `references/graph-control.md`: dual-graph boundary, modes, commands, structured handoff/result, impact, and stops.
- `assets/baseline-templates/`: loop-only baseline templates.
- `../dev-flow-master/references/state-and-gates.md` § Bounded Convergence Policy: the single source for checker thresholds, materiality, and evaluation budget semantics.

Every step must satisfy its **Complete when:** criterion. A checker score, artifact file, or phase agent success alone cannot complete a loop stage.
