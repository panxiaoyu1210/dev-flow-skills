# Flow And Recovery Reference

## Table of Contents

- [When to Use](#when-to-use)
- [Flow Structure](#flow-structure)
- [Stage Order](#stage-order)
- [Existing Change / Spec Check](#existing-change--spec-check)
- [Progress Queries](#progress-queries)
- [Context Recovery Protocol](#context-recovery-protocol)
- [Guardrails](#guardrails)

## When to Use

以下触发场景仅供参考，不作为路由决策的规范来源。路由分类的权威定义在 `dev-flow-intent/references/classification-reference.md`。

Use this skill when the user asks for dev-flow or when a development request may need dev-flow routing, for example:

- “先按规范走一下”
- “先做需求分析/设计”
- “先别写代码，先把流程定下来”
- “按 OpenSpec 流程来”
- “先出文档再开发”
- “这次要不要走完整流程？”
- “看一下 dev flow / 按 dev flow 执行”
- “修一下这个报错 / 测试挂了”
- “帮我 review 一下”
- “这个页面/交互/布局调整一下”
- “刚才那个需求改成另一种”

Do not force the governed document path for a tiny one-file fix, a simple explanation request, or direct continuation of an already approved stage where a more specific skill applies. The master may still be used briefly to classify and route those requests.

## Flow Structure

```text
Entry
  dev-flow-master: existing context check + dev-flow-intent + route

Specialized routes
  dev-flow-debugging: root-cause-first debugging route
  dev-flow-ui-ux: user-facing UI/UX route with runtime verification expectations
  dev-flow-review: read-first findings route

Planning
  dev-flow-planning: pre-artifact clarification + user approval → OpenSpec/opsx artifacts + independent checker → [OpenSpec Baseline Gate] → task orchestration/test matrix
  dev-flow-git: Git mode proposal before Phase 2 Gate
  → [Phase 2 Gate]

Execution
  dev-flow-execution ↔ dev-flow-git
  continuous execution + dynamic replanning until hard-stop or completion

Acceptance
  dev-flow-acceptance: final checks + delivery report + readiness
```

A phase gate is never a soft stop. OpenSpec Baseline Gate and Phase 2 Gate require explicit user consent. After Phase 2 Gate is cleared, Phase 3 is run-to-completion except for hard-stop conditions defined in `dev-flow-execution` and `dev-flow-git`.

## Stage Order

1. Existing change/spec check
2. Intent classification — load `dev-flow-intent`
3. Route selection — master emits `routing_decided`
4. Complexity routing and path selection — master internal for routes that proceed to implementation
5. For all implementation work: route to the OpenSpec/opsx artifact path; focused route owners may execute or verify only inside that artifact workflow, never instead of it
6. If medium/heavyweight: load `dev-flow-planning`
7. Pre-artifact clarification and artifact-start approval — `dev-flow-planning`
8. OpenSpec/opsx baseline artifacts, independent checker review, and OpenSpec Baseline Gate — `dev-flow-planning`
9. Task orchestration, detailed Executable Test Matrix, system-level checks, and orchestration checker — `dev-flow-planning`
10. Git mode preparation — `dev-flow-git`
11. Phase 2 Gate — explicit user approval before execution
12. TDD execution and dynamic replanning — `dev-flow-execution`; Git decisions through `dev-flow-git`
13. Acceptance — `dev-flow-acceptance`
14. Completion gate — master checks acceptance evidence and reports final state

**Loop-authorized phase entry:** when dev-flow receives a confirmed loop-authorized phase handoff (all five conditions in `routing-and-complexity.md §Loop-Authorized Phase Mode` are verified), entry begins at step 6 with the loop context already established. Steps 1–5 are replaced by verifying the loop signals; steps 8 and 11 skip the interactive user gate (see loop-authorized exception in `state-and-gates.md`). Record the loop authorization locally by authority mode: Legacy writes `dev-flow-state.md`; Shadow writes its approved fenced Markdown projection source and creates a new snapshot; Graph writes through the Master Graph CLI/API and only then refreshes its evidence view.

Continue-by-default rule:

- Stage completion is an internal control point, not a default user-facing stop point.
- If the next stage is executable without new user input, continue automatically.
- Exceptions: OpenSpec Baseline Gate and Phase 2 Gate always require explicit user approval, unless the loop-authorized exception applies.
- During Phase 3, never stop after a task, batch, progress update, patch-ready output, or automatic replan if execution can safely continue.

## Existing Change / Spec Check

Before opening a new governed flow, check for relevant existing OpenSpec/change/spec context:

- active change
- relevant proposal/design/tasks/spec
- signals that the request continues an existing thread

If relevant context exists, prefer continuing or updating it instead of blindly creating a new path.

## Progress Queries

When the user asks “进度怎么样 / 状态 / 到哪了 / 还剩多少”, resolve progress from the active authority and answer in Chinese: Legacy reads `dev-flow-state.md` and `progress.md`; Shadow reads the approved fenced Markdown projection and verifies its snapshot; Graph derives the control answer only from `dev-flow graph check`, `next`, and targeted `context`. In Graph mode, Markdown views are non-input evidence: stale, tampered, or conflicting views never change the answer and are regenerated from Graph. Before any authority state exists, summarize the current stage verbally and say that no governed state exists yet.

## Context Recovery Protocol

When a dev-flow session resumes, context was compacted, a new session starts, or the agent is unsure whether memory is stale, do not continue from chat memory.

Resolve authority before reading status: if `Docs/<topic>/dev-flow-graph.json` exists, run `dev-flow graph check --json`, then `next` and targeted `context`. Shadow projection errors or drift block routing until the approved fenced projection source creates a new explicit one-way snapshot target. Graph mode never reads a generated Markdown view back into machine state. If no Graph exists, retain the Legacy recovery order below.

Before any new planning, execution, Git, or acceptance action, reload or re-read:

1. `dev-flow-master`
2. the current phase skill: `dev-flow-planning`, `dev-flow-execution`, `dev-flow-git`, or `dev-flow-acceptance`
3. active control state: Legacy reloads `dev-flow-state.md`, `progress.md`, and `task-orchestration.md`; Shadow reloads the approved fenced Markdown projection and verifies the current snapshot; Graph runs `dev-flow graph check`, `next`, and targeted `context`, treating generated Markdown as non-input evidence and regenerating any stale, tampered, or conflicting view
4. OpenSpec/opsx artifacts, canonical `test-plan.md`, and relevant requirement/design artifacts as evidence or change inputs
5. actual Git/filesystem/task state
6. resolve loop authorization from the active authority: Legacy reads `dev-flow-state.md` and `loop-state.md`; Shadow reads the approved fenced Markdown projection and verifies its fresh snapshot; Graph queries the separate Master and Loop Graphs through the CLI/API and never treats generated Markdown as input. When `loop_authorized: true`, re-verify `loop_baseline_ready` (`baseline_status` remains `user_confirmed`), `loop_control_ready` (`loop_id`, `auto_continue_scope`, `envelope_required`), `loop_envelope_ready` (budget remaining, `dev_flow_phase_handoff`, `auto_continue_scope`), confirmed loop-only baseline artifact paths, and the current Loop Phase DAG node; do not treat the session as a fresh dev-flow entry

Recovery rules:

- Resolve recovery priority locally by authority: Legacy uses actual state then its Markdown ledgers; Shadow uses actual state then the approved projection plus verified snapshot; Graph uses actual state then `dev-flow graph check`, `next`, and targeted `context`. Graph Markdown views are non-input evidence, never merge back, and are regenerated when stale, tampered, or conflicting.
- For an unresolved gate, missing approval, stale signal, or required repair, Legacy reads `dev-flow-state.md`, Shadow reads the approved projection and verified snapshot, and Graph accepts the condition only from `dev-flow graph check`, `next`, and targeted `context`; Graph views are non-input evidence and are regenerated rather than used to select the recovery point.
- If `progress.md` says a requirement change, stale task, failed task, skipped task, rollback, pause, or gate re-entry is pending, Legacy resumes that ledger recovery point; Shadow resumes only when the approved projection and verified snapshot contain it; Graph resumes only when `dev-flow graph check`, `next`, and targeted `context` select it. Graph views are non-input evidence and stale, tampered, or conflicting copies are regenerated.
- If `dev-flow-state.md`, `task-orchestration.md`, and `progress.md` disagree, Legacy routes the ledger conflict to the current phase owner, Shadow reconciles the approved projection against its snapshot, and Graph ignores the views as non-input control and uses `dev-flow graph check`, `next`, and targeted `context` before regenerating them. If the active authority still cannot reconcile actual state after one attempt, hard-stop and present the actual-state conflict, the active authority result, and a recommendation; do not recursively re-route.
- If actual Git/filesystem state contradicts active control state, actual state is the change input: Legacy repairs its Markdown ledgers; Shadow repairs the approved projection and creates a new explicit snapshot; Graph records impact or a legal transition through the CLI/API, reruns `check`, `next`, and targeted `context`, and regenerates views. A Graph view is never an input to that correction.
- Preview `dev-flow graph impact` for requirement, artifact, file, or task changes. `unknown_impact` requires conservative Master/Loop replanning and is never evidence of no impact.
- Chat memory is lowest priority and must not override persisted artifacts or actual state.

## Guardrails

- Do not replace opsx, OpenSpec, or superpowers; route to them when they own the work.
- Do not force heavy orchestration for every request; use the classification matrix.
- Do not advance past OpenSpec Baseline Gate or Phase 2 Gate without explicit user approval.
- Do not let the main agent self-approve gate-impacting scores, phase_eval, or readiness. Use independent checker subagents with raw artifacts.
- Do not hide the Phase 3 execution mode; show the proposed execution actor and any concurrency/worktree approval needed before asking for Phase 2 approval.
- Do not dispatch execution agents before Phase 2 Gate is cleared.
- Do not claim completion before system-level checks, requirements/design/test coverage, independent acceptance checker evidence, and `dev-flow-acceptance` evidence satisfy the Completion Gate.
- Do not run `/dev-flow-cr` automatically; it is a separate user-triggered command after user acceptance.
- Do not perform external side effects, destructive Git actions, pushes, PRs, merges, production operations, or paid-service actions without the authorization rules in `dev-flow-git`.
