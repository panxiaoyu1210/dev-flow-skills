# Readiness And Report Reference

## Table of Contents

- [Inputs](#inputs)
- [Final Acceptance Duties](#final-acceptance-duties)
- [Delivery Report Contents](#delivery-report-contents)
- [Evidence Storage and Git Tracking](#evidence-storage-and-git-tracking)
- [Independent Acceptance Checker](#independent-acceptance-checker)
- [Final Test Failure](#final-test-failure)
- [Acceptance Readiness](#acceptance-readiness)
- [Required Signal](#required-signal)

## Inputs

Recover actual Git/filesystem/task results first. In Graph mode, then read `Docs/<topic>/dev-flow-graph.json`, run `dev-flow graph check`, and request targeted `context` before reading OpenSpec/evidence views. In Shadow, validate the fenced projection source and checked snapshot; in Legacy, use the Markdown ledgers. For a loop-authorized phase, validate the accepted handoff against current Loop and Master control state before producing a phase result. Generated Markdown views never override Graph authority.

Then read and reconcile the applicable evidence:

- `dev-flow-state.md`
- `task-orchestration.md`
- OpenSpec/opsx requirements, design/spec, tasks, and test artifacts
- `test-plan.md` when present as a loop baseline or legacy artifact
- `progress.md`
- OpenSpec/opsx change directory and status for all implementation work
- actual Git/filesystem/task results
- Runtime Orchestration State from `dev-flow-execution`
- loop baseline / Loop Phase DAG / phase ID when invoked from a delivery loop

Do not rely on chat memory over files and actual state. Every later control-state persistence instruction follows the selected mode: Legacy writes its ledger, Shadow writes its approved projection source and creates a new snapshot, and Graph writes through the CLI/API before regenerating evidence views.

## Final Acceptance Duties

1. Run final commands listed in the Executable Test Matrix.
2. Run system-level checks that exercise the complete requested workflow or user/system journey.
3. Verify no regressions from previously passing tests; keep raw command output in the transient runtime area rather than formal artifact directories.
4. Collect applicable quality evidence:
   - source/docs grounding
   - API contract
   - UI/browser runtime
   - security
   - performance
   - migration/deprecation
   - release/rollback
5. Verify every task has explicit integration state through `dev-flow-git`.
6. Verify task local verification evidence and TDD evidence exist for each integrated task.
7. Verify every OpenSpec requirement/design/test item is covered by implementation evidence and a passing or explicitly deferred check.
8. Run an independent acceptance checker subagent before readiness is declared.
9. Write `Docs/<topic>/delivery-report.md` or the canonical legacy path.
10. For loop-authorized phases, write phase acceptance evidence that the loop can use for `phase_eval` and next-phase or repair decisions.
11. Perform safe cleanup through `dev-flow-git` only where allowed.
12. In Graph mode, create the schema-valid acceptance result and perform any completion transition only after the independent checker and all prerequisites pass.

## Delivery Report Contents

The report must include:

- completed tasks with task IDs and branch/PR/commit/patch references
- skipped/deferred tasks with reason, user/gate acceptance, and accepted risk
- test results: command, scope, pass/fail count or concise summary, coverage summary if available
- final Executable Test Matrix result, including commands run, commands not run, reasons, and acceptance impact
- system-level test results and workflow coverage
- requirements/design/test coverage map, including deferred items and accepted risks
- acceptance checker score, findings, and raw evidence scope
- quality-gate evidence and evidence locations
- dynamic replanning decisions and old/new task mappings
- fallback modes used and why
- task local verification evidence by task
- TDD evidence by task: RED, GREEN, refactor verification, or approved exception
- phase-level OpenSpec/opsx evidence when invoked from a delivery loop
- unresolved failures, blockers, or accepted known risks
- scope changes since Phase 1/Phase 2 approval and whether gate re-entry occurred or was not required
- known issues and follow-up items
- Git integration/cleanup status

## Evidence Storage and Git Tracking

`delivery-report.md`, `dev-flow-state.md`, `progress.md`, `task-orchestration.md`, applicable final requested reports, OpenSpec/opsx artifacts, and formal Loop documents are Git-tracked formal artifacts when Git integration is authorized. Preserve them in the staging allowlist.

Raw checker rounds, captured stdout/stderr, full test logs, coverage output, screenshots/video, browser traces, benchmark/timing files, debug dumps, temporary patches, and intermediate conversions are transient. Store workflow-created copies under `.dev-flow/runtime/<run-id>/` and rely on `dev-flow-git` to keep that path locally excluded through `.git/info/exclude`. Do not copy raw output into formal Markdown merely to make evidence durable; record the command, result, relevant counts, and concise findings instead.

Before declaring `acceptance_ready`, inspect Git status and the staged path list when staging is authorized. A staged transient artifact is `not-ready` until it is unstaged without deleting the local evidence. Use the staging allowlist; do not use `git add -A` or `git add .`. Do not modify project `.gitignore` automatically and do not disturb unrelated user files.

## Independent Acceptance Checker

Before emitting `acceptance_ready`, spawn a checker subagent with raw artifacts only:

- OpenSpec/opsx change artifacts
- `task-orchestration.md` and Executable Test Matrix
- implementation diff or changed-file list
- test/diagnostic/system-check output
- TDD evidence
- delivery report draft if already written

Do not pass the main agent's expected conclusion. The checker must verify:

- implementation satisfies all OpenSpec requirements and design/spec decisions
- every test-plan item maps to passing evidence or an explicit user-approved deferral
- system-level checks cover the complete requested workflow and major failure modes
- no task lacks TDD evidence unless the user approved an exception
- `/opsx:verify <change>` evidence exists and aligns with actual changed files
- unresolved risks are visible and not silently accepted

Use bounded convergence for readiness. The quality target is 95. `max_checker_evaluations` is the configurable upper budget for this checkpoint and defaults to 3. A score from 90 through 94 may pass when all objective acceptance and system-level checks pass, no P0/P1 or unresolved material finding remains, and either the current checker reports only non-material findings or the latest re-review improves by fewer than 2 points. A material finding affects behavior, correctness, security, data integrity, compatibility, deployability, acceptance evidence, or a machine-consumed schema. Formatting, wording, YAML key order, or renaming an unconsumed field is non-material; do not route back, consume the remaining budget, or re-run the checker only to chase those points. Scores below 90 and unresolved material findings route back to execution, planning, or the user when the configured budget is exhausted.

## Final Test Failure

If final checks fail:

- identify likely source task; bisect if needed
- do not report acceptance complete
- create a fix/retry/replan path through `dev-flow-execution`
- ask for user recovery only when hard-stop conditions require it: destructive rollback, retry limit exhausted, missing non-fallback dependency, or changed requirement baseline

## Acceptance Readiness

Readiness is authority-specific: Legacy evaluates the persisted Markdown ledgers; Shadow evaluates the approved fenced Markdown projection only after its snapshot verifies; Graph mode additionally requires `dev-flow graph check`, `next`, and targeted `context`, whose results are the sole control input for readiness. Markdown views are never a Graph completion criterion: their existence, missing content, stale content, tampering, or claimed gate clearance cannot make or block readiness, and conflicting views are regenerated from Graph.

For governed medium/heavy Legacy/Shadow work, report `ready-to-report` only when:

1. required OpenSpec/opsx artifacts exist as persisted files
2. OpenSpec Baseline Gate and Phase 2 gates were explicitly cleared in `dev-flow-state.md`
3. `dev-flow-state.md`, `task-orchestration.md`, `progress.md`, and `delivery-report.md` exist for their defined creation triggers: `dev-flow-state.md` from first planning gate; `task-orchestration.md` from Phase 2; `progress.md` from Phase 2 Gate or earlier; `delivery-report.md` from acceptance.
4. all DAG tasks are completed, explicitly accepted as deferred by the user/gate, or replanned under governed rules
5. per-task, batch, and final Executable Test Matrix checks pass or are explicitly accepted as deferred scope by the user/gate
6. system-level checks pass or are explicitly blocked with user-approved deferral
7. requirements/design/test coverage map is complete
8. task local verification evidence and TDD evidence exist for integrated work; independent CR evidence is optional and only produced by `/dev-flow-cr`
9. checker satisfies bounded convergence with no P0/P1 or unresolved material findings
10. every task has a canonical Git/patch integration state defined by `dev-flow-git`: `merged`, `committed`, `pr_opened`, `direct_commit_complete`, `patch_ready`, `shared_working_tree_applied` (= changes made directly in the shared working tree by a serial sub-agent), `applied_from_shared_worktree_patch` (= patch generated by a worktree-isolated sub-agent then applied to the shared working tree), or `deferred_accepted`
11. applicable quality gates are satisfied or marked N/A with reason, including `ui_ux_report` when `ui_runtime` risk applies
12. no unresolved blockers remain

For lightweight Legacy/Shadow opsx/OpenSpec work, report `ready-to-report` only when:

1. the four signals `lightweight_artifact_ready`, `opsx_apply_complete`, `opsx_verify_complete`, and `acceptance_ready` are persisted by the active authority: Legacy records them in `dev-flow-state.md` or the equivalent OpenSpec/opsx status artifact; Shadow records them in its approved fenced Markdown projection and has a fresh matching snapshot
2. the OpenSpec change directory exists and contains the artifacts required by the active schema
3. implementation tasks are complete or explicitly accepted as deferred in the OpenSpec tasks artifact
4. `/opsx:verify <change>` evidence exists and records skipped checks, residual risks, and final recommendation
5. Git/patch state is explicit through `dev-flow-git` when side effects are involved
6. required focused-route reports exist, including `debugging_report` for debugging work and `ui_ux_report` for UI runtime risk
7. TDD evidence exists for implementation tasks or an approved exception is recorded
8. final and system-level checks appropriate to the change pass or are explicitly marked N/A with reason
9. checker satisfies bounded convergence with no P0/P1 or unresolved material findings; documentation-only changes with no behavior/config/test/user-visible impact retain their existing exception
10. no unresolved blockers remain

For Graph mode, both governed and lightweight readiness come only from schema-valid Gate, Task, Test, Evidence, Git, and related nodes returned by `dev-flow graph check`, `next`, and targeted `context`. Evidence nodes may reference OpenSpec, test, delivery, or report files, but a Markdown file's existence, absence, or contents never independently satisfy or block Graph readiness. Missing required Graph evidence blocks through the Graph query; stale, tampered, or conflicting generated views are regenerated.

If any authority-mode criterion is missing, report `not-ready` or `ready-for-review` and continue the stage selected by that authority rather than claiming completion.

## Required Signal

Persist `acceptance_ready` by authority mode: Legacy writes `dev-flow-state.md`; Shadow writes the approved fenced Markdown projection and creates a fresh snapshot; Graph writes through the Master Graph CLI/API before refreshing any evidence view. The compatibility evidence shape is:

```yaml
acceptance_ready:
  producer: dev-flow-acceptance
  timestamp: <ISO-8601>
  path: lightweight | governed
  checklist_passed: true
  delivery_report_path: <path>          # governed work only; omit for lightweight
  openspec_change_path: <path>          # lightweight work only; omit for governed
  git_integration_state: <canonical state name>
  quality_evidence_paths: [list of file paths]
  system_level_checks: [list of commands/evidence]
  requirements_design_test_coverage: complete | incomplete | deferred_with_user_approval
  checker_score: <integer>
  outstanding_deferred: [list of task ids or none]
```
