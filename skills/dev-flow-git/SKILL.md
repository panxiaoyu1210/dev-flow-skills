---
name: dev-flow-git
description: Use when dev-flow must choose or apply Git isolation, commits, PRs, patch-ready output, conflict handling, rollback, cleanup, or side-effect permissions.
---

# dev-flow-git

Own Git isolation, integration state, permissions, rollback, conflict handling, and cleanup. It does not implement product changes. All user-facing replies and persisted Markdown artifacts are written in Chinese.

## Machine Authority

The versioned contracts in `schemas/v1/` and the `dev-flow graph` CLI are the machine-rule source of truth for Graph permissions and Git control state. Read `../dev-flow-master/references/graph-control.md` before permission-backed Graph transitions; Git operational truth remains actual repository state plus the references below.

## Steps

1. **Inspect capability and scope.** Read actual branch/worktree/status/remotes, user authorization, repository policy, task overlap, and Graph `context` when present. Preserve unrelated user changes.
   **Complete when:** allowed and forbidden side effects, target paths, authority, rollback constraints, and unresolved blockers are explicit.

2. **Select isolation and integration.** Apply `references/modes-and-states.md`; writer concurrency never exceeds both DAG safety and repository isolation. Default to patch-ready when commit/remote authority is absent.
   **Complete when:** one isolation mode, one integration mode, writer cap, fallback, and allowed canonical task states are selected.

3. **Emit the safety decision.** Persist `git_safe`; when Graph mode models the decision, validate it with `dev-flow graph check` and expose only the minimal permission context to the next owner.
   **Complete when:** the Phase 2 consumer can machine-check permissions and no capability exception is treated as a grant.

4. **Perform approved operations.** Follow `references/operations-and-safety.md`; use explicit-path staging allowlists, keep transient evidence under `.dev-flow/runtime/<run-id>/`, and record Graph `transition` only after the real Git action and evidence succeed.
   **Complete when:** actual Git state, persisted integration state, Graph state, and verification evidence agree for every operated task.

5. **Resolve or stop.** Handle conflicts, rollback, and cleanup only inside the approved mode. Route any destructive or broader side effect to explicit user approval.
   **Complete when:** the operation is safely complete with recovery evidence, or a blocker states the exact permission/action and next owner.

## Context Pointers

- `references/modes-and-states.md`: isolation, integration, concurrency, and canonical states.
- `references/operations-and-safety.md`: permission checks, formal/transient files, staging, operations, conflicts, rollback, and cleanup.
- `../dev-flow-master/references/graph-control.md`: Graph permission context and legal transitions.

The `git_safe` schema is owned by the versioned Graph contracts where modeled and by `dev-flow-master/references/state-and-gates.md` for Legacy Markdown. This Skill keeps only execution order and completion criteria.
