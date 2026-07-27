# Operations And Safety Reference

## Table of Contents

- [Capability and Permission Check](#capability-and-permission-check)
- [Artifact Tracking and Staging](#artifact-tracking-and-staging)
- [Worktree Mode Rules](#worktree-mode-rules)
- [Branch-Only Rules](#branch-only-rules)
- [Shared-Working-Tree Serial Agent Rules](#shared-working-tree-serial-agent-rules)
- [Integration Steps](#integration-steps)
- [Conflict Handling](#conflict-handling)
- [Rollback Safety](#rollback-safety)
- [Cleanup](#cleanup)
- [Required Signal](#required-signal)

## Capability and Permission Check

Graph permissions summarize real grants; they do not create them. A capability-exception reason is audit metadata only and cannot turn a deny/missing grant into permission. If `dev-flow graph transition` rejects the actor, preserve the prior Graph/Git state and route the blocker.

Before selecting any mode that creates commits, pushes branches, opens PRs, or merges, verify:

- working tree cleanliness and current branch
- remote availability and target integration branch
- push/PR tooling availability
- explicit user authorization for commits and remote side effects
- repository policy constraints such as protected branches or required checks, if discoverable

If any required capability or authorization is missing, use `patch-ready mode` and state that implementation/tests can continue without commit/PR/merge automation.

## Artifact Tracking and Staging

Classify files by lifecycle role, not extension. A Markdown or spreadsheet file is tracked when it is a canonical formal artifact; a Markdown file containing raw checker output is still transient.

Git-tracked formal artifacts include requested source/config/test changes, OpenSpec/opsx artifacts, `dev-flow-state.md`, `task-orchestration.md`, `progress.md`, `delivery-report.md`, final requested CR/debugging/UI reports, and Loop artifacts `requirements.md`, `high-level-design.md`, `detailed-design.md`, `test-plan.md`, `test-cases.xlsx`, `loop-phase-dag.md`, `loop-envelope.md`, `loop-state.md`, `phase-artifacts.md`, and `opsx-index.md`.

Transient process artifacts include raw checker prompts/responses and round-by-round reports, captured stdout/stderr, full test logs, coverage output, screenshots, videos, browser traces, benchmark and timing data, debug dumps, temporary patches, and intermediate conversion files. Store workflow-created transient output under `.dev-flow/runtime/<run-id>/`, not under `Docs/<topic>/`, the Loop artifact directory, or OpenSpec/opsx source directories. Formal artifacts record commands, results, and concise evidence summaries rather than copying raw output.

In a Git repository:

1. Check whether the project already provides an ignored runtime/evidence location. Otherwise use `.dev-flow/runtime/<run-id>/` and add `.dev-flow/runtime/` to the repository-local `.git/info/exclude` (resolve it with `git rev-parse --git-path info/exclude`). Do not modify the project `.gitignore` unless the user explicitly requests a shared ignore rule.
2. Build a staging allowlist from the implementation scope plus canonical formal artifacts for the active request. Do not use `git add -A` or `git add .` in dev-flow-managed staging.
3. Inspect `git status --short`, stage only explicit allowlisted paths, then inspect `git diff --cached --name-only` and `git status --short` again.
4. If a transient artifact created by the current workflow was staged, unstage only that path without deleting it. Never unstage, delete, ignore, or overwrite unrelated user files.
5. If the user explicitly promotes transient evidence into a durable deliverable, move or summarize it into a canonical artifact path before tracking it. Do not track the runtime copy.

Patch-ready mode still forbids staging. These rules apply only after the selected integration mode and user authorization allow staging or committing.

## Worktree Mode Rules

- Create/enter a dedicated worktree for each parallel task.
- Do implementation and verification inside that worktree.
- Stage, commit, PR, review, or merge only if selected integration mode allows it.
- Never share one working tree between concurrent task agents.
- Do not run high-overlap writer tasks concurrently; split them into serial sub-waves before dispatch.
- Tasks marked with `file_overlap: high` or `symbol_overlap: high` in task-orchestration.md must be serialized as writers even in worktree-parallel mode. Git isolation does not make overlapping implementation safe by itself. See `modes-and-states.md` for the full overlap-safe concurrency rules.

## Branch-Only Rules

- Create a feature branch in current working tree.
- Run serially only.
- Never execute two task agents concurrently in the same working tree.

## Shared-Working-Tree Serial Agent Rules

Use this when the user wants sub-agents to directly modify the current local checkout, without creating worktrees or local task branches.

Rules:

1. No additional worktree is created.
2. No additional local branch is required unless the user explicitly asks for one.
3. Only one writing task agent may run at a time.
4. The writing task agent may edit files directly in the current working tree.
5. The task must settle and the main agent must verify diagnostics/tests before another writing task agent starts.
6. The main agent must reconcile actual Git/filesystem state after each task and update Runtime Orchestration State.
7. If the working tree contains unrelated user changes, the main agent must preserve them and avoid staging/committing unless explicitly authorized.
8. Parallel analysis-only agents may run, but they must not write files while a writing task agent is active.

## Integration Steps

### PR/review/merge mode

1. Confirm correct branch/worktree.
2. Stage through the artifact staging allowlist and commit the reviewed staged diff.
3. Open PR targeting integration branch.
4. Record local verification evidence when external review tooling is unavailable; this does not replace `/dev-flow-cr` or independent checker gates.
5. Merge only after review passes and required checks allow it.

### Solo-dev direct-commit mode

1. Confirm correct approved branch/worktree.
2. Stage through the artifact staging allowlist and commit the reviewed staged diff.
3. Perform and record local verification evidence.
4. Do not push or merge unless explicitly approved.

### Patch-ready mode

1. Do not stage, commit, push, open PR, or merge.
2. Report changed files, verification evidence, and patch/diff-ready status.
3. Leave integration decision to main agent/user after aggregation or later explicit Git gate.

### Shared-worktree patch mode

Use this when the user wants multiple agents but does not want worktrees.

Rules:

1. Sub-agents must not edit files in the shared working tree.
2. Sub-agents may read files, analyze, design tests, propose implementation steps, and produce patch/diff-ready output.
3. Sub-agents must include expected changed files, patch content or precise edit instructions, required diagnostics/tests, and risk notes.
4. The main agent is the only writer to the shared working tree.
5. The main agent applies patch outputs one at a time, rechecks actual file state before each apply, resolves overlap, then runs required diagnostics/tests.
6. If two patch outputs touch overlapping files or symbols, the main agent serializes them and treats the second as needing rebase/reconciliation against the updated local state.
7. A sub-agent patch is not considered complete until the main agent has applied it, verified it, and updated Runtime Orchestration State.

Every completed task must have one canonical integration state from `Canonical Task Integration States`.

## Conflict Handling

When conflict appears:

1. Detect conflicting files and source tasks.
2. Attempt safe auto-merge on a temporary merge branch only if allowed by current Git mode.
3. If auto-merge succeeds, continue and report it.
4. If auto-merge fails, hard-stop for manual resolution.
5. After manual resolution, re-run affected verification if resolution changed implementation.

Do not silently block a batch on unresolved conflict.

## Rollback Safety

Rollback after committed work requires safety check:

- verify current branch/worktree
- list commits and files affected
- obtain explicit approval for destructive actions
- prefer `git revert` for pushed, reviewed, merged, or non-isolated commits
- use `git reset --hard` only for unpushed isolated task branch/worktree after confirming no unrelated changes exist

## Cleanup

Delete `task/*` branches only after verifying they are merged or no longer needed. Do not delete patch-ready or unmerged work without explicit approval.

Never force-push, hard-reset shared work, amend pushed commits, bypass hooks, or perform destructive Git actions unless BOTH conditions are met: (1) the user has explicitly requested it in the current message, AND (2) a protected-branch check passes (the target branch is not listed as a protected branch in the repo settings or CI configuration).

## Required Signal

Emit `git_safe` with: isolation mode, integration mode, writer concurrency limit, allowed side effects, forbidden side effects, capability/permission check result, rollback constraints, unresolved Git blockers, and the canonical integration states allowed for this workflow.

In Graph mode, persist the machine representation through the versioned schema and atomic Graph writer, then run `dev-flow graph check`; the Markdown signal is a view/evidence index rather than a second writable fact source.
