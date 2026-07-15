---
name: dev-flow-debugging
description: Use when a development request involves bugs, failing tests, build failures, runtime errors, regressions, broken interactions, unexpected behavior, logs, incidents, or any fix that needs root-cause investigation before code changes.
---

# dev-flow-debugging

Own root-cause-first debugging before any fix. Selected after `dev-flow-intent` emits `task_type: debugging`.

## Boundary

Diagnose and guide fixes. Do not bypass `dev-flow-master` for complexity routing, gates, Git side effects, or final completion. If diagnosis reveals feature work, requirement change, UI/UX work, or review-only work, return that recommendation to master.

本地根因协议始终是必需且自足的硬契约。其证据结构和升级阈值见 `references/debugging-evidence.md`；可选能力可以补充上下文，但不能替代该协议。

## Language Policy

All user-facing replies and all generated artifact documents (requirements, design, specs, CLI specs, test plans, delivery reports, and other persisted Markdown files) in dev-flow must be written in Chinese.

## Core Contract

1. 稳定复现并记录失败命令或步骤、退出码与输出摘要；先收集证据，再提出可证伪假设并定位根因。
2. 修复前写回归失败测试（failing test first），运行它并记录 observed RED；失败必须来自待修行为，而不是测试错误。
3. 只做针对根因的 minimal GREEN，随后重跑原失败检查、相关检查和回归验证；仅在绿色后重构。
4. 不可复现时停止修复，报告尝试、证据缺口和安全下一步；不得猜测修复。
5. Scope the fix (contained/moderate/broad) before routing.
6. Emit debugging_report regardless of whether the route is lightweight or governed.

## References

Load `references/debugging-evidence.md` when entering a debugging session. It contains the reproduction protocol, evidence schema, and escalation rules.

## Iron Rule

Do not propose or implement a fix until the root cause has been investigated. A guessed patch is not a debugging result.

## Route Summary

Small bounded root-cause fixes route to lightweight opsx/OpenSpec artifact execution with focused verification. Cross-module, contract, data, security, release, or UI-runtime impact routes back to master for governed handling. UI runtime bugs require `ui_ux_report` before acceptance.

Read `references/debugging-evidence.md` before reproducing failures, gathering evidence, emitting `debugging_report`, or deciding UI follow-up.

## Required Signal

```yaml
debugging_report:
  producer: dev-flow-debugging
  bug_id: <string>
  reproduction_confirmed: true | false | intermittent
  root_cause: <description>
  fix_scope: contained | moderate | broad
  recommended_next_route: dev-flow-master | dev-flow-master lightweight | ui-ux | change-adjustment
  evidence_paths: [list]
```
