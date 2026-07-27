---
name: dev-flow-loop-envelope
description: Use when defining budget, permissions, cadence, stop conditions, locks, safety limits, auto-continue, baseline authority, or approval boundaries for repeated or scheduled Loop Engineering.
---

# Dev Flow Loop Envelope

Define the approved safety envelope before repeated, scheduled, background, persistent, or auto-continuing Loop activity. This Skill prepares controls; `dev-flow-scheduler` owns automation mutation. All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth. Read `../dev-flow-loop/references/graph-control.md` before Graph-backed envelope/budget decisions and `references/budget-and-safety.md` for the human policy. Field inventories remain in contracts, not this Skill.

## Steps

1. **Recover loop coordinates.** Read the Loop goal, baseline authority, phase DAG, current envelope/budget, trigger, actual side effects, and Graph `context` when present.
   **Complete when:** scope, owner, trigger, evidence source, existing approvals, and conflicts are explicit.

2. **Set finite controls.** Define cadence/schedule policy, numeric iteration/repair/checker/pass/agent/retry limits, wall time/cost ceiling, overlap lock, and trace/eval checkpoints using `references/budget-and-safety.md`.
   **Complete when:** every repeated branch has a finite budget, measurable stop, and escalation action; missing mandatory control makes the proposal blocked.

3. **Set permission boundaries.** Separate allowed effects, approval-required effects, and forbidden effects. `within_confirmed_baseline` is available only for a user-confirmed baseline and approved phase handoff; a capability note never grants authority.
   **Complete when:** every possible write, Git, scheduler, external, paid, or destructive action has one unambiguous permission outcome and owner.

4. **Validate controls.** In Graph mode run `dev-flow graph check`, then `next`/`context`; preview `impact` when an envelope or budget changes. Keep Loop Graph controls isolated from Master Tasks.
   **Complete when:** envelope, budget, DAG, baseline, and permissions agree, with `unknown_impact` routed to conservative review.

5. **Emit or block.** Persist `loop_envelope_ready` in Loop state and transition modeled control nodes only after real approval/evidence. Route approved automation operations to `dev-flow-scheduler`.
   **Complete when:** status is `ready` with all controls and approval references, or `blocked` with the exact missing control, stop reason, and next owner.

## Context Pointers

- `references/budget-and-safety.md`: required control meanings, defaults, auto-continue, approvals, blockers, and escalation.
- `../dev-flow-loop/references/graph-control.md`: Loop Graph authority, eligibility, impact, transition, and handoff boundary.
- `../dev-flow-loop/references/control-plane.md`: baseline, phase DAG, checker, and eval lifecycle.

The `loop_envelope_ready` field contract is owned by `schemas/v1/` where modeled and by the Loop control reference for Legacy compatibility. Completion requires step 5's checkable result, not merely an envelope draft.
