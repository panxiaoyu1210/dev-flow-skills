# Master Graph Control Reference

Use this reference when a governed project has Graph state, when choosing authority mode, when state may be stale, before a machine-governed gate/transition, or when accepting a Loop phase handoff. `schemas/v1/**` and `lib/graph/**` are authoritative for fields and semantics; this file explains when to call them.

## Authority Modes

- **Legacy:** Markdown remains authoritative and no formal Graph is required. `dev-flow graph check`, `next`, and `context` return the compatibility route when the Graph path is absent. Continue the existing Markdown workflow.
- **Shadow:** Markdown is authoritative only after explicit opt-in: the source set contains at least one fenced `dev-flow-graph` JSON projection and each source contains at most one. `init --mode shadow` creates a read-only snapshot only after its exclusive writer rereads and validates the current sources; caller verification flags are not witnesses. `check` blocks on projection errors or drift. Refresh by initializing a new snapshot target, never by overwriting, mutating, or merging the existing snapshot.
- **Graph:** `Docs/<topic>/dev-flow-graph.json` is authoritative. A generated Markdown view is presentation only; Graph mode must not allow it to overwrite Graph state.

One project state has one writer. Authority selection is persisted; there is no two-way merge and no dual-writable fact source.

## Stable Locations

- Master state: `Docs/<topic>/dev-flow-graph.json`
- Generated view: `Docs/<topic>/dev-flow-graph.md`
- Raw events and transient evidence: `.dev-flow/runtime/<run-id>/`
- Requirements and design prose: the project's OpenSpec/opsx artifacts

Graph stores stable IDs, references, hashes, states, relations, permissions, and evidence summaries. OpenSpec/opsx keeps the full requirement and design body.

## Command Sequence

| Need | Command | Checkable result |
|---|---|---|
| Create authority state | `dev-flow graph init --graph <path> --type master --mode <mode>` | Selected mode is persisted; Legacy creates no Graph file. |
| Validate before decisions | `dev-flow graph check --graph <path> --json` | The success envelope contains `valid: true`; otherwise route the findings. |
| Assess a change | `dev-flow graph impact --graph <path> --kind <kind> --source <value> --json` | Typed closure and route are reviewed before mutation. |
| Persist stale propagation | add `--apply` in Graph mode | A new revision and generated view are written; Shadow/Legacy remain read-only. |
| Choose work | `dev-flow graph next --graph <path> --json` | Owner/action and eligible/blocked work are explicit. |
| Dispatch minimal evidence | `dev-flow graph context --graph <path> [--node <id>] --json` | Schema-valid package contains only the selected governance closure. |
| Change modeled status | `dev-flow graph transition --graph <path> --node <id> --to <status> --actor <id> --json` | Permission, prerequisites, evidence, event, revision, and generated view succeed. |

Use `node bin/dev-flow.mjs graph --help` for accepted options, projection error codes, and stable result meanings. A producer that creates or updates graph structure uses the exported `lib/graph` contract API, then runs `check`; agents do not invent extra fields or repair invalid state silently.

## Decision Protocol

1. Run `check` before `next`, `context`, `impact`, or `transition`. Completion: schema, references, DAG, coverage, gates, evidence, reviewer independence, and permissions have no findings.
2. Run `next` and targeted `context` for the owning stage. Completion: the dispatched owner sees eligible work plus every relevant blocker, not the whole graph.
3. Preview `impact` after a requirement, artifact, file, or task changes. Completion: the typed closure classifies stage-local repair, Master replanning, Loop baseline change, or `unknown_impact`.
4. Treat `unknown_impact` as conservative routing. Completion: an owner investigates/replans; no claim of “no impact” is emitted.
5. Use `transition` after, never instead of, the real approval/action/evidence. Completion: the command succeeds and the persisted event reference resolves.

The CLI help is the exit/result source of truth. Callers consume its JSON envelope rather than duplicating numeric mappings in prose. `unknown_impact` is always a conservative workflow block, including an explicit Graph impact request when no Graph is present; ordinary Legacy work remains compatible by not invoking Graph impact.

Graph-mode recovery follows `actual state -> Graph -> OpenSpec/evidence views`. Write control facts only through the Graph CLI/API, then regenerate downstream Markdown views. Never read a generated view back into the Graph.

## Gate and Completion Rules

The Master Graph governs Requirement/Task/Test/Gate/Evidence/Git/Failure control state. Query results assist routing but do not replace OpenSpec/opsx, independent checkers, user gates, Git permission, or side-effect approval.

A completion transition is legal only when required task/test/gate/Git/failure states and fresh evidence are ready. If `next` is blocked, return its reasons to the owning skill. If evidence or the source revision changes, run impact and restore readiness before retrying.

## Loop Boundary

Loop and Master Graphs are separate. Master never modifies the Loop Baseline; Loop never schedules Master-internal Tasks. A Loop phase enters Master only through the schema-valid phase handoff described in `dev-flow-loop/references/graph-control.md`. Always `await` handoff/result APIs; when either input is Shadow, each API rereads the relevant source at entry using `sourceRoot`, or separate `loopSourceRoot` and `masterSourceRoot`. In Graph mode, persist the new Master Graph returned by handoff acceptance atomically before execution; in Shadow mode, an exact receipt must already exist in the authoritative fenced projection and a missing receipt requires a new one-way snapshot. Acceptance and result creation require that persisted receipt. Any Loop coordinate drift invalidates the handoff and requires reissue.
