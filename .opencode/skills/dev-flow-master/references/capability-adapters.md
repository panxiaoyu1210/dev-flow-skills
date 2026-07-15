# Capability Adapters Reference

## 目录

- [核心契约](#核心契约)
- [检测与刷新顺序](#检测与刷新顺序)
- [Grill-me 澄清适配](#grill-me-澄清适配)
- [Trellis 局部能力向量](#trellis-局部能力向量)
- [SPEC_MATCHED 约束](#spec_matched-约束)
- [capability_context 结构](#capability_context-结构)
- [规范权威与事实证据](#规范权威与事实证据)
- [阶段消费规则](#阶段消费规则)
- [生命周期 handoff 与授权](#生命周期-handoff-与授权)
- [失效与恢复](#失效与恢复)

## 核心契约

- 始终让 OpenSpec/dev-flow 拥有需求、设计、验收、gate、任务编排和完成结论。
- 始终让本地澄清、根因分析、逐任务 TDD、Git 安全和 fresh evidence-before-claim 独立可运行。
- 只把 Grill-me 和 Trellis 当作可选能力；缺失、失败或用户拒绝不得降低交付要求。
- 只读取已知文件、运行时技能目录和平台提供的可验证路径。不得创建 Trellis 文件，不得执行未知脚本。
- 把所有检测结果写入同一个可持久化 `capability_context`；阶段文件只记录消费结果，不复制适配算法。

## 检测与刷新顺序

1. 解析项目根路径，并读取已有 `dev-flow-state.md`；不得用聊天记忆补齐路径或当前 task。
2. 按精确名称探测 Grill-me，并记录四态、原因和已确认决策。
3. 仅当项目 `.trellis/workflow.md` 存在且可读时启用 Trellis-aware 模式。
4. Trellis-aware 模式下逐项探测 task、spec、workspace、injected context 和 check；一个分量失败不得覆盖其他分量。
5. 写入检测时间、证据路径、失败原因、当前 task、制品映射和失效键。
6. 在规划、Phase 3 派发、恢复和 lifecycle handoff 前重新比较失效键；发现变化时先按[失效与恢复](#失效与恢复)处理。

检测只能产生能力事实，不得自行通过 gate、创建 task、运行 check、归档、写 journal 或同步外部系统。

## Grill-me 澄清适配

### 精确发现与四态

只查询当前运行时公开的技能目录，并要求技能名称与 `grill-me` 完全相等。不得通过别名、描述、前缀或模糊匹配推断可用性。

| 状态 | 可观察判定 |
|---|---|
| `AVAILABLE` | 精确目录项存在，技能定义可读且可按当前指令加载 |
| `UNAVAILABLE` | 精确目录项不存在 |
| `LOAD_FAILED` | 精确目录项存在，但定义不可读、解析失败或指令契约不兼容 |
| `DECLINED` | 用户明确拒绝访谈，或启动后明确中止 |

`LOAD_FAILED` 必须记录失败阶段和可公开原因；`DECLINED` 必须记录最后一个已确认决策。不得把任一状态解释为需求已澄清或 gate 已通过。

### 使用谓词

仅当至少一个未决问题满足下列可观察谓词时，优先提出 Grill-me：

- 至少存在两个满足当前约束的方案，且会改变 requirement、设计、API/数据、安全/发布边界、验收或任务 DAG 中至少一项。
- 一个尚未证实的假设会改变高风险、不可逆或外部副作用决策。
- 需求缺少可验证成功条件，导致无法写出唯一的 acceptance 或 RED。
- 三个及以上相互依赖的决策分支尚未收敛。

先从仓库和已批准制品推导答案，再一次只问一个最高价值问题，并给出 2–3 个可行选项和推荐。将确认结果写入 OpenSpec/dev-flow 正式制品；Grill-me 不拥有制品或 gate。

### 本地回退

当状态为 `UNAVAILABLE`、`LOAD_FAILED` 或 `DECLINED` 时：

1. 保留全部已确认答案。
2. 从最后确认点继续。
3. 一次询问一个高价值问题。
4. 给出 2–3 个具体选项、推荐和影响。
5. 未确认分支继续标为未决，不得推断为批准。

## Trellis 局部能力向量

### 入口条件

- `.trellis/workflow.md` 存在且可读：设置 `trellis.mode: available`，再探测其余分量。
- 文件缺失或不可读：设置 `trellis.mode: unavailable`，记录原因，且不得探测或执行其余 Trellis 能力。
- 目录存在本身不构成可用证据。

### 分量判定

| 分量 | available 的可观察谓词 | 局部降级 |
|---|---|---|
| `workflow` | 入口文件存在且可读 | 整体 mode 为 unavailable |
| `task_context` | 当前 task 可唯一解析，且其 task/PRD 引用文件均存在并可读 | 不创建或猜测 task；继续 OpenSpec 规划 |
| `spec_context` | `.trellis/spec/` 的适用索引可读，且当前 package/layer 可映射到至少一个可读规范 | 继续使用 OpenSpec、仓库模式和测试矩阵 |
| `workspace_memory` | developer identity 唯一，且对应 workspace 索引存在并可读 | 多 workspace 无法归属时不得猜测 |
| `injected_context` | hook/平台给出来源和路径，且该已知路径可验证、存在并可读 | 直接读取已知文件，不依赖注入内容 |
| `check` | 运行时技能目录存在精确 `trellis-check` 项 | 仍执行 dev-flow 测试矩阵 |

每个分量使用 `available | unavailable | failed`，并分别记录 `evidence_paths` 与 `failure_reason`。未找到对象使用 `unavailable`；本应可读但读取或解析失败使用 `failed`。

不得枚举后执行 `.trellis/scripts/` 中的未知内容。不得通过运行脚本来证明能力存在。

### check 的写入边界

`check.detected` 只表示精确技能项已发现。检测必须记录至少一个可审计 source locator：优先写 `check.evidence_paths`；目录项没有文件路径时，必须写包含 catalog source、entry id 和观察时间的 `check.catalog_evidence_reference`。两者同时为空时不得设置 `detected: true`。

`check.executable_now` 仅在下列条件全部为真时设为 `true`：

- 当前处于 Phase 3。
- 当前任务明确把该 check 列入范围。
- writer lane 已分配给执行者。
- check 可能修改的每个路径都在当前任务写入范围内。
- 适用的 Git/副作用权限已经满足。

任一条件为假或未知时，将 `check.executable_now` 设为 `false` 并记录原因。

无法证明 check 只读时，按可能写入处理。只读 acceptance 不得调用它；允许时也应作为独立任务运行，其输出只作为补充验证证据。

## SPEC_MATCHED 约束

`spec_context.match_state` 使用 `NOT_EVALUATED | NO_MATCH | SPEC_MATCHED`。

只有同时满足以下条件才可写入 `SPEC_MATCHED`：

1. 记录每个匹配 Trellis spec 的规范路径及适用 package/layer。
2. 提取与本任务相关的约束引用或简短摘要。
3. 将这些约束写入当前任务上下文或该任务验证证据。
4. 在 `constraints_recorded_in` 标记 `current_task_context` 或 `verification_evidence`，并记录可读的目标证据路径。

仅找到文件但未完成第 3–4 步时，不得声称 `SPEC_MATCHED`。没有匹配规范时写 `NO_MATCH` 并继续标准 dev-flow；读取失败时写 `spec_context.status: failed`。

## capability_context 结构

在 `dev-flow-state.md` 持久化以下最小结构；未知值写 `null` 并配套原因，不得猜测：

    capability_context:
      schema_version: 1
      observed_at: <ISO-8601>
      invalidation_key:
        session_id: <current-session-id>
        project_root: <canonical-project-root>
        workflow_path: <path-or-null>
        current_task: <task-id-or-null>
        user_decision_revision: <monotonic-marker>
      grill_me:
        exact_skill_id: grill-me
        state: AVAILABLE | UNAVAILABLE | LOAD_FAILED | DECLINED
        failure_reason: <reason-or-null>
        confirmed_decisions: [list-or-none]
      trellis:
        mode: available | unavailable
        workflow_path: <path-or-null>
        failure_reason: <reason-or-null>
        current_task: <task-id-or-null>
        capabilities:
          workflow:
            status: available | unavailable | failed
            evidence_paths: [list-or-none]
            failure_reason: <reason-or-null>
          task_context:
            status: available | unavailable | failed
            task_path: <path-or-null>
            prd_path: <path-or-null>
            failure_reason: <reason-or-null>
          spec_context:
            status: available | unavailable | failed
            match_state: NOT_EVALUATED | NO_MATCH | SPEC_MATCHED
            spec_paths: [list-or-none]
            mapping: [<package-or-layer -> path>]
            constraints_recorded_in: current_task_context | verification_evidence | null
            evidence_path: <path-or-null>
            failure_reason: <reason-or-null>
          workspace_memory:
            status: available | unavailable | failed
            developer_identity: <identity-or-null>
            workspace_path: <path-or-null>
            failure_reason: <reason-or-null>
          injected_context:
            status: available | unavailable | failed
            provenance: <hook-or-platform-or-null>
            evidence_paths: [list-or-none]
            failure_reason: <reason-or-null>
          check:
            status: available | unavailable | failed
            exact_skill_id: trellis-check
            detected: <true-or-false>
            executable_now: <true-or-false>
            evidence_paths: [list-or-none]
            catalog_evidence_reference:
              catalog_source: <runtime-skill-catalog-or-null>
              entry_id: <catalog-entry-id-or-null>
              observed_at: <ISO-8601-or-null>
            failure_reason: <reason-or-null>
        artifact_mapping:
          - openspec_path: <path>
            trellis_path: <path>
            coverage: <referenced-constraints>
      lifecycle_handoff:
        state: NONE | PROPOSED | AUTHORIZED | RUNNING | PARTIAL | SUCCEEDED | FAILED | INVALIDATED
        handoff_items:
          - action: archive | journal | sync
            target: <task-or-workspace>
            state: PROPOSED | AUTHORIZED | RUNNING | SUCCEEDED | FAILED | INVALIDATED
            authorization:
              session_id: <current-session-id-or-null>
              project_root: <canonical-project-root-or-null>
              workflow_path: <path-or-null>
              current_task: <task-id-or-null>
              action: <same-as-item-action>
              target: <same-as-item-target>
              approval_evidence: <current-session-text-or-null>
            git_state_evidence:
              source: fresh_actual_state | git_safe_reference
              observed_at: <ISO-8601-or-null>
              fresh_git_state: <branch-head-index-worktree-summary-or-null>
              git_safe_evidence_reference: <path-and-signal-marker-or-null>
            execution_precheck:
              checked_at: <ISO-8601-or-null>
              authorization_matches_current_context: <true-or-false>
              git_evidence_valid_now: <true-or-false>
              failure_reason: <reason-or-null>
            result:
              evidence_paths: [list-or-none]
              failure_reason: <reason-or-null>

## 规范权威与事实证据

严格区分两条顺序：

- 规范权威：已批准的 OpenSpec/dev-flow requirement、design、acceptance 和 gate > 被这些制品显式引用的 Trellis PRD/spec > 未采纳的 Trellis 上下文 > 聊天记忆。
- 事实证据：实际 Git/文件系统和 fresh 命令输出 > 持久化 dev-flow 执行状态 > Trellis task/workspace 状态 > 聊天记忆。

Trellis PRD/spec 与 OpenSpec 重叠时，只保存路径和覆盖映射，不复制同义内容。

发现冲突时执行 requirement-change gate：

1. 记录冲突路径、冲突条款和 fresh 事实。
2. 停止受影响阶段推进，并标记 `requirement_change_pending`。
3. 若实现漂移，按已批准基线修复；若规范确需变化，返回 planning 和相应 OpenSpec/Phase gate。
4. 不得让实际状态或 Trellis 内容反向改写已批准规范。

## 阶段消费规则

| 阶段 | 允许消费 | 必须产出 |
|---|---|---|
| 入口/恢复 | 只读能力检测与 fresh 事实 | 刷新的 `capability_context` |
| 规划 | Grill-me 决策；可用的 task/PRD、workspace、injected context | OpenSpec/dev-flow 正式决策、路径映射和失败原因 |
| Phase 3 派发前 | 当前 package/layer 的 spec；受 writer 边界约束的 check 状态 | 任务上下文或验证证据中的 Trellis 约束 |
| Acceptance | 已有 task/workspace 状态和 fresh 输出 | dev-flow 自有验收结论；不得运行可能写入的 check |
| `acceptance_ready` 之后 | lifecycle 建议与用户当前会话决定 | 仅记录 handoff；具体写入归 Trellis 流程 |

任何可选能力失败都只降低对应分量，不得跳过本地阶段契约、测试矩阵或 gate。

## 生命周期 handoff 与授权

- dev-flow 只在 `acceptance_ready` 后提出并记录 `lifecycle_handoff`。
- archive、journal、sync 必须逐项列出动作和目标，并由用户在当前会话明确触发或授权对应 Trellis command/skill。
- Git 提交、分支或回滚批准不包含 lifecycle 权限；涉及 Git 的 handoff 仍须满足 `dev-flow-git`。
- 每个 handoff item 独立绑定 action、target 和 authorization；不得用一个动作的授权覆盖另一动作或目标。
- 每个 item 执行前必须重新核对授权中的 session、项目根路径、workflow 路径、当前 task、action、target 和 approval evidence。
- 每个 item 必须记录当前 precheck 的 fresh Git state，或引用仍适用于相同上下文的有效 `git_safe` evidence；证据引用不授予 lifecycle 权限。
- 任一授权字段不匹配，或 Git 证据已失效时，将该 item 设为 `INVALIDATED` 并停止该 item。
- 未授权时只保留 `PROPOSED`，不得执行、自动重试或把建议解释为同意。
- Trellis 流程拥有实际写入；dev-flow 只记录目标、决定和结果。
- 部分成功时重新读取实际状态，逐 item 标记 `SUCCEEDED` 或 `FAILED`；不得自动重试，也不得回滚已完成动作。
- handoff 发生在完成结论之后，其成功或失败不得反向改变已成立的 dev-flow acceptance。

## 失效与恢复

当 session、项目根路径、workflow 路径、当前 task 或用户决定修订号任一变化时：

1. 将旧 `capability_context` 标为 stale。
2. 将每个旧 handoff item 及其 authorization 设为 `INVALIDATED`，清空可执行批准。
3. 从入口文件开始重新只读探测，重新建立局部能力向量。
4. 对照 fresh Git/文件系统事实和持久化状态记录对账结果。
5. 需要 lifecycle 写入时，要求用户在当前会话重新逐项授权。

上下文压缩或新会话不得复用旧 lifecycle 授权；即使路径与 task 文本相同，也必须使用新的当前会话授权证据。
