---
name: dev-flow-acceptance
description: Use when dev-flow execution batches are complete and the main agent must run final acceptance, collect quality evidence, write delivery report, and decide readiness.
---

# dev-flow-acceptance

## Boundary

This skill owns final readiness assessment, evidence collection, and delivery report generation.

Does NOT execute tasks, modify code, or re-enter earlier phases.

## Language Policy

All user-facing replies and all generated artifact documents (requirements, design, specs, CLI specs, test plans, delivery reports, and other persisted Markdown files) in dev-flow must be written in Chinese.

Own final acceptance after DAG batches or lightweight opsx/OpenSpec work are complete, deferred, or replanned. Acceptance decides readiness; it does not rely on chat memory or agent self-reporting.

Use `superpowers:verification-before-completion` when available before claiming complete, fixed, passing, or ready.

## Core Contract

- Reconcile persisted artifacts, actual Git/filesystem state, task results, and Runtime Orchestration State.
- Run final and system-level checks from the Executable Test Matrix, and verify all work against `/opsx:verify <change>` evidence.
- Use an independent checker subagent for final requirements/design/test coverage and readiness judgments; the main agent may collect evidence but must not be the only reviewer for pass/fail. Persist the score and use bounded convergence: the quality target is 95, the convergence floor is 90, and `max_checker_evaluations` is a configurable per-checkpoint upper budget that defaults to 3. A 90–94 result may pass when all objective checks pass and no P0/P1 or unresolved material finding remains, and either the checker reports only non-material findings or the latest re-review improves by fewer than 2 points. A material finding affects behavior, correctness, security, data integrity, compatibility, deployability, acceptance evidence, or a machine-consumed schema; prose style, formatting, YAML key order, or an unconsumed field name is non-material and must not trigger score-chasing edits or force the budget to be exhausted.
- Confirm task local verification evidence, TDD evidence, phase-level OpenSpec/opsx evidence, and canonical Git/patch integration states. Independent CR is user-triggered through `/dev-flow-cr`; loop-authorized phases may feed acceptance evidence to `phase_eval`, which must not call `/dev-flow-cr` or emit `cr_report_ready`.
- Write `delivery-report.md` for governed work and record readiness evidence for lightweight opsx/OpenSpec work.
- Report `not-ready` or `ready-for-review` when required evidence is missing; do not claim completion.

Read `references/readiness-and-report.md` before final verification, delivery report writing, failure recovery, readiness decisions, or emitting `acceptance_ready`.

## References

Load `references/readiness-and-report.md` for readiness checklist, report template, and signal schema.

## Required Signal

Emits `acceptance_ready`. Full schema defined in `references/readiness-and-report.md`.
