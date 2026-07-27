---
description: Run the governed Dev Flow workflow for a development task.
---

# Dev Flow

Use this command as the slash-command entrypoint for Dev Flow Skills.

## Workflow

1. Use the `dev-flow-master` skill as the entry controller.
2. Resolve authority: when `Docs/<topic>/dev-flow-graph.json` exists, run `dev-flow graph check`, `next`, and targeted `context`; otherwise retain the Legacy Markdown workflow. Shadow is explicit opt-in through a fenced `dev-flow-graph` projection and remains read-only; Graph is Graph-to-Markdown-view only.
3. Let `dev-flow-master` load `dev-flow-intent` to classify the request as debugging, feature, change-adjustment, review, UI/UX, status-recovery, or question.
4. Follow the route chosen by the master: focused diagnosis/review, lightweight OpenSpec/opsx artifact path, or governed OpenSpec/opsx planning/execution path.
5. For any implementation work that changes code, config, tests, or user-visible behavior, create/apply/verify OpenSpec/opsx artifacts before completion, normally through `/opsx:ff`, `/opsx:apply`, and `/opsx:verify`; focused skills may operate inside that path, not replace it.
6. If medium/heavy planning is required, use `dev-flow-planning` for OpenSpec baseline refinement, independent checker review, DAG, detailed test matrix, system-level checks, and Git safety, then wait for required user confirmations.
7. During implementation, use `dev-flow-execution` to preview Graph `impact` for material changes, apply stale propagation only in Graph mode, and continue until all planned tasks settle.
8. Use `dev-flow-git` before any Git side effect such as branching, committing, PR creation, patch generation, rollback, or cleanup.
9. Before reporting completion, use `dev-flow-acceptance` to collect fresh evidence and record a Graph `transition` only after the modeled prerequisites pass.

## Rules

- Do not skip clarification, planning, orchestration, Git safety, or acceptance gates when the task requires governed flow.
- Do not treat this command as a chat-only summary. It is an execution workflow.
- Do not skip intent classification for new dev-flow entry requests.
- All implementation work must leave persisted evidence through OpenSpec/opsx artifacts. If OpenSpec/opsx is unavailable or uninitialized, stop and ask whether to initialize/install it or explicitly exit dev-flow. A direct change without artifacts is not a dev-flow delivery path.
- TDD is required for every implementation task, including lightweight work, unless the user explicitly approves an exception.
- Any score, gate pass/fail, phase_eval, or readiness judgment that affects continuation must use an independent checker subagent with raw artifacts.
- Before Phase 3, show the proposed execution actor after task orchestration, parallel-safety, and Git checks; do not assume multi-agent or worktree use without explicit approval.
- Do not run CR automatically. After delivery, users may run `/dev-flow-cr` after their own acceptance.
- If requirements change during execution, return to planning before continuing implementation.
- If local files would be overwritten, preserve modified content unless the user explicitly approves a force operation.
- In Git repositories, treat canonical formal artifacts (including dev-flow/Loop Markdown and test-case workbooks) as Git-tracked formal artifacts, store transient verification output under `.dev-flow/runtime/<run-id>/` with local `.git/info/exclude`, and stage only through the `dev-flow-git` staging allowlist; do not use `git add -A` or `git add .`.
- `schemas/v1/**` and the Graph CLI/library are the machine-rule source of truth. OpenSpec owns full requirement/design prose; Graph stores stable control references and evidence summaries.
- Treat `unknown_impact` as a conservative workflow block, including an explicit impact request without Graph state. Use `dev-flow graph --help` for result meanings; never infer “no impact” or repair an illegal transition silently.

## User Request

Apply the workflow above to the user's current request and any arguments supplied after `/dev-flow`.
