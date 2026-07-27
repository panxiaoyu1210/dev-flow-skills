# Graph Control Kernel

The Graph Control Kernel is an optional Node.js ESM control layer for deterministic dev-flow state. It does not replace OpenSpec/opsx, user gates, checker review, Git permissions, side-effect approval, or the Markdown workflow. `schemas/**` define persisted contracts and `lib/graph/**` plus the `dev-flow graph` CLI define machine semantics.

## Authority and Compatibility

| Mode | Authority | Direction | Mutation |
|---|---|---|---|
| Legacy | Markdown | none | Existing Markdown workflow; no formal Graph is required. |
| Shadow | Markdown | Markdown → Graph snapshot | Explicit opt-in, read-only Graph; drift blocks machine routing. |
| Graph | Graph JSON | Graph → generated Markdown view | Atomic Graph revisions; generated views are never read back as authority. |

There is no bidirectional merge and no dual-writable fact source. A project without Graph state continues through Legacy behavior. Shadow and Graph are explicit opt-in modes.

Shadow accepts a source set only when it contains at least one fenced JSON projection with this exact info string, and each source contains at most one such fence:

````markdown
```dev-flow-graph
{"nodes":[],"edges":[],"permissions":[]}
```
````

The JSON object is governed by `schemas/v1/**`; ordinary Markdown without this fence remains Legacy input and never creates an empty Shadow Graph. Master projections may include `handoffReceipts`; Loop projections may not. Both `init` and `check` return stable `shadow_projection_missing`, `shadow_projection_invalid`, or `shadow_projection_ambiguous` findings when this contract fails. `check` hashes the canonical fenced projection for each source and compares the canonical merged projection. Markdown prose plus source, top-level, and nested semantic-set ordering therefore do not cause drift, while a missing source or Graph semantic change does. A Shadow refresh is a new explicit one-way `init` to a new snapshot target; the exclusive writer rereads and validates the current sources itself and ignores caller-supplied verification witnesses. It never overwrites an existing target, mutates the read-only snapshot, or merges Graph facts back into Markdown. Graph-mode overwrite remains validated and atomic; Legacy has no formal Graph writer.

OpenSpec/opsx remains the source for full requirement and design prose. Graph stores stable IDs, references, hashes, state, relations, permissions, and evidence summaries.

## Isolated Graphs

- Master Graph: `Docs/<topic>/dev-flow-graph.json`; controls Requirement/Task/Test/Gate/Evidence/Git/Failure.
- Loop Graph: `Docs/<topic>/loop/loop-graph.json`; controls Goal/Baseline/Phase/Envelope/Budget/Eval.
- Runtime events and temporary evidence: `.dev-flow/runtime/<run-id>/`.

Loop and Master Graphs do not share writable nodes. Loop cannot schedule Master-internal Tasks; Master cannot modify the Loop Baseline. A versioned phase handoff connects Loop to Master, and a bound acceptance/phase-eval result returns control.

Loop routing resolves the current Goal domain before selecting a Phase. One operational Goal is authoritative; multiple operational Goals require an unambiguous Phase relation or route to explicit resolution rather than ID-based guessing. Only when no operational Goal exists may terminal historical Goals participate in routing. Within the selected Goal domain, routing selects an active Phase first; otherwise it selects only a dependency-eligible ready Phase from the Phase DAG. Goal completion is evaluated over the Goal's explicit Phase domain, with a single-Goal fallback for unambiguous legacy graphs. Every Phase and its unique Eval participate in that completion decision; a stopped Phase routes to review rather than completion.

The phase handoff freezes canonical Requirement summaries together with the complete Loop control projection. Its required `projectionHash` binds every immutable issued field except the digest itself. This checksum proves content integrity, not acceptance. `acceptPhaseHandoff` validates the live projection and returns a new Master Graph revision containing a canonical accepted-handoff receipt. The caller must atomically persist that returned Graph with the Graph write API before Master execution. `createAcceptanceResult` and every result consumer require the exact receipt; a missing or conflicting receipt routes to reaccept/reissue rather than trusting a recomputed object checksum.

In Shadow mode, an exact receipt already present in the authoritative fenced projection is accepted. Every handoff, acceptance, result, and phase-evaluation API call rereads and validates the relevant Shadow Markdown at the same entry point; callers should `await` these APIs and pass `sourceRoot`, or distinct `loopSourceRoot` and `masterSourceRoot`. An in-memory receipt or prior verification result is never a witness. A missing receipt cannot mutate the read-only snapshot: update the Markdown projection and explicitly create a new snapshot. In Graph mode only, acceptance returns a revision-plus-one clone and never mutates the input object. Requirement and artifact arrays are unordered semantic sets and are emitted in stable order. Membership or Requirement ref/hash/source-revision drift requires a new handoff. Graph references use a semantic hash that canonicalizes Graph collection and receipt order while remaining sensitive to status, relationship, and content changes; ordinary Master execution may evolve after issuance without being mistaken for handoff tampering.

A phase result carries the admitted handoff digest as `handoffHash`. Its `evaluationHash` covers every semantic result field except the digest itself, with set-valued fields canonicalized. This is also an integrity checksum, not an identity or authorization root: a caller can recompute it after changing content. The persisted Master Graph receipt and its single-writer authority boundary remain the admission trust root; no secret, credential, or signature is implied.

## CLI

All commands accept human-readable output and `--json`. Use `node bin/dev-flow.mjs graph --help` for the complete option surface.

```sh
dev-flow graph init --graph Docs/topic/dev-flow-graph.json --type master --mode graph
dev-flow graph check --graph Docs/topic/dev-flow-graph.json --json
dev-flow graph impact --graph Docs/topic/dev-flow-graph.json --kind requirement --source requirement.id --json
dev-flow graph next --graph Docs/topic/dev-flow-graph.json --json
dev-flow graph context --graph Docs/topic/dev-flow-graph.json --node task.id --json
dev-flow graph transition --graph Docs/topic/dev-flow-graph.json --node task.id --to complete --actor reviewer.id --json
```

- `dev-flow graph init` selects Master/Loop and Legacy/Shadow/Graph authority. Legacy creates no Graph. Shadow requires the explicit projection contract above. Graph creates a generated view.
- `dev-flow graph check` validates versioned schema, identity/reference integrity, DAG/coverage/overlap/gate/reviewer/evidence/permission semantics, runtime event references, and Shadow drift.
- `dev-flow graph impact` computes a typed closure from a requirement, artifact, file, or task. Preview is the default; `--apply` atomically persists stale propagation only in Graph mode. Unmodeled dependencies, including an explicit impact request without Graph state, return `unknown_impact` and block for conservative routing.
- `dev-flow graph next` returns the next owner/action plus stable `targetNodeIds` and structured `blockers`; the existing eligible/blocked task and phase lists remain compatibility projections of that result. CLI findings, minimal context, and phase handoff consume the same target/blocker conclusion. An empty Master Graph routes to requirement definition; an empty Loop Graph routes to Goal/Baseline establishment, never acceptance or completion.
- `dev-flow graph context` returns a schema-valid minimal context package for the selected governance closure.
- `dev-flow graph transition` checks permissions, prerequisites, gates, evidence, and premature completion before writing a runtime event and Graph revision.

Graph structure producers use the exported `lib/graph/**` API against `schemas/**`, then run `check`. The six-command CLI intentionally has no generic field editor; this prevents silent repair and ungoverned schema mutation.

## Result Handling

`dev-flow graph --help` is the single source for stable exit meanings. Illegal transitions, gate skipping, missing evidence, permission denial, stale Shadow state, and `unknown_impact` are explicit outcomes rather than silent fixes. `unknown_impact` always blocks for conservative routing. JSON callers consume the stable envelope and findings instead of parsing human text.

## Persistence and Atomicity

Formal Graph state uses `schemaVersion` and JSON Schema. Graph revisions are written by temporary file plus atomic rename. A transition writes its immutable raw event under the runtime directory before the Graph references it; an orphan raw event is harmless, while a dangling Graph event reference fails validation.

Graph-mode recovery order is `actual state -> Graph -> OpenSpec/evidence views`. Control facts, including accepted-handoff receipts, are written only through the Graph CLI/API. Receipt admission returns an updated in-memory Graph; it is authoritative only after the caller persists it through the same validated atomic Graph writer. Generated Markdown views are downstream presentation, are regenerated after the Graph write, and are never read back or used to override formal JSON.

## Package Surface

The npm package includes `lib/graph/**` and `schemas/**`. AJV is the only added runtime dependency. The kernel adds no LangGraph, graph database, background service, long-running daemon, or automatic Agent scheduler, and it does not raise the declared Node.js version requirement.

## Skill Authoring Quality Checklist

This checklist follows `writing-great-skills` and applies to the seven Graph-aware Skills.

| Check | Evidence required |
|---|---|
| Predictability | Ordered steps select the same authority/check/next/context/impact/transition process for the same state. |
| Completion criterion | Every step ends with a checkable **Complete when:** condition. |
| Single source of truth | `schemas/v1/` and CLI/library own all Graph machine rules; OpenSpec owns requirement/design prose; each authority mode has one writer. |
| Progressive disclosure | Core Skills remain at most 80 lines; each agent procedure is normative only in its owning direct reference, while this document is a non-normative pointer. |
| Duplication | Each agent procedure has one owning direct reference; other Skills and docs point to it without restating the procedure. |
| No-op | Generic “be careful/thorough” lines are removed; retained instructions change routing, evidence, or stopping behavior. |
| Sediment | Stale chat-memory, dual-ledger, and repeated field inventories are removed from core Skills. |
| Sprawl | Long schemas, signal fields, checklists, and operations remain in schemas or focused references with TOCs over 100 lines. |
| Premature completion | Agent messages, artifact existence, checker score alone, or partial tests cannot satisfy step completion. |

Doctor verifies schema compilation, kernel exports, CLI help, package entries, Skill size/pointers, reference TOCs, mirrors, structural authoring rules, explicit prohibitions, and a finite observable-completion heuristic. This automation does not replace an independent `writing-great-skills` semantic review of intent, accuracy, or completion quality.

## Known Limits

The kernel is a control-state engine, not a workflow daemon. It does not discover work, run agents, mutate schedulers, or replace external coordination. Shadow refresh is a one-way regeneration from Markdown rather than a merge. Consumers still create domain nodes/edges through the exported contract API; the CLI deliberately exposes governed operations rather than a generic upsert command.
