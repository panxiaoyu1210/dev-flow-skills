## Context

dev-flow 当前把外部流程方法同时写入核心技能、阶段参考、Loop 规则、文档、命令和 CLI 语义校验。基线测试确认：本地根因分析、TDD 和验收协议已经能够独立运行，但技能仍优先指向旧外部流程；Grill-me 与 Trellis 没有可发现的阶段映射；`doctor` 也无法阻止旧标识重新进入发布包。

本文中的“旧流程包/遗留流程能力”专指用户要求从项目内彻底移除的外部流程包。目标标识以机器可读分片持久化：`identifier_fragments: ["super", "power"]`、`match_mode: ascii_case_insensitive_substring`；实现时只在内存中连接分片，禁止把连接结果写入源码或制品。该映射同时覆盖单复数品牌和命名空间形式，并让最终仓库与 npm 发布面仍可用零完整字面命中验收。

本项目以 `skills/` 为源技能，以 `.opencode/skills/` 为严格镜像，并同时发布 Codex、OpenCode、Claude 命令和用户文档。OpenSpec/dev-flow 制品继续作为交付与门禁的事实源。Trellis 仅在目标项目已初始化时提供项目规范、任务上下文和跨会话记忆，不得取代 OpenSpec、dev-flow 状态或 Git 权限规则。

## Goals / Non-Goals

**Goals:**

- 让 dev-flow 在没有任何外部流程技能时仍完整执行调试、TDD、验收和恢复。
- 让 dev-flow 即使看到运行时已安装的遗留流程能力，也不因任何项目内指令去发现、加载、路由、调用、推荐或要求它们。
- 将 Grill-me 作为需求与设计分支澄清的首选可选助手。
- 将 Trellis 作为已初始化项目的上下文与任务生命周期适配器。
- 建立 OpenSpec/dev-flow 与 Trellis 之间清晰、单向可追踪的所有权和去重规则。
- 清除所有发布表面的旧标识，并让 `doctor` 阻止回归。
- 保持源技能、镜像、命令、文档和 CLI 语义检查一致。

**Non-Goals:**

- 不在该发行仓库初始化 Trellis。
- 不复制或改写 Grill-me/Trellis 的实现。
- 不让 Trellis 取代 OpenSpec、dev-flow gate、TDD 或根因分析。
- 不自动执行 Trellis 的提交、任务归档或 journal 写入。
- 不修改、禁用或卸载用户全局安装的技能；全局平台自身的自动触发政策不由该仓库控制。
- 不处理与本次解耦无关的轻量执行主体等既有流程问题。

## Decisions

### 1. dev-flow 本地契约是唯一必需能力

调试阶段直接要求 `dev-flow-debugging` 的复现与根因协议；执行阶段直接要求 RED、GREEN、重构和证据记录；完成阶段直接要求 fresh evidence-before-claim 和独立 acceptance checker。外部技能只能增强这些阶段，不能决定阶段是否可运行。

项目级“不触发”定义为：dev-flow 发布内容中不存在对遗留流程包或其子技能的发现、加载、路由、调用、推荐、required sub-skill、optional helper、when-available fallback 或命名空间指令。即使运行时技能目录包含这些能力，dev-flow 也只选择本地契约、Grill-me 或按条件启用的 Trellis。若平台全局政策在 dev-flow 之外独立触发已安装技能，必须在结果中标为外部触发，而不得归因于 dev-flow；全局技能管理不进入本次实现。

前向测试用统一来源事件记录八类动作：

```yaml
trigger_trace:
  event_type: discover | load | route | invoke | recommend | required | optional | fallback
  source: dev-flow | platform_global | user_direct
  instruction_path: "skills/dev-flow-planning/SKILL.md | external://platform-policy"
  target_identifier_match: true | false
  allowed: true | false
```

当 `source: dev-flow` 且 `target_identifier_match: true` 时，八类动作全部必须为 `allowed: false` 并使测试失败。`platform_global` 只用于来源归因，不得修改全局目录，也不得输出安装、禁用或卸载建议。

**替代方案：**把 Grill-me/Trellis 改成硬依赖。拒绝，因为这只是把一种强耦合替换为另一种强耦合，并破坏未初始化 Trellis 项目的可用性。

### 2. Grill-me 负责对话式澄清，不拥有制品或门禁

当需求模糊、存在多个有效方案、架构取舍或高风险假设时，规划阶段优先加载 Grill-me：先检查仓库可推导信息，再逐个问题沿决策树收敛，每个问题给出推荐答案。结论必须写入 OpenSpec requirements/design/tasks 和 `dev-flow-state.md`；Grill-me 不得替代 artifact-start、OpenSpec Baseline 或 Phase 2 Gate。

入口通过当前运行时公开的技能目录按精确名称 `grill-me` 发现能力，并在 `capability_context` 中记录 `available`、`unavailable`、`load_failed` 或 `declined`。读取失败、指令不兼容或用户中止访谈时，从最后一个已确认决策继续使用本地规则，不丢弃已确认答案，也不把失败当作 gate 通过。

若 Grill-me 不可用或未完成，`dev-flow-planning` 使用同等的本地规则：一次一个高价值问题、先推导后提问、给出 2–3 个可行选项和推荐。

### 3. Trellis 采用条件检测与只增益适配

`.trellis/workflow.md` 可读是 Trellis-aware 的唯一入口条件；其余能力独立探测并形成能力向量，而不是要求一次性全部存在：

| 字段 | 可用条件 | 缺失或失败时行为 |
|---|---|---|
| `workflow` | `.trellis/workflow.md` 可读 | 标记 `mode: unavailable`，跳过整个适配 |
| `task_context` | 当前 task 可解析且 PRD/任务文件可读 | 标记 unavailable；不创建任务，继续 OpenSpec 规划 |
| `spec_context` | `.trellis/spec/` 索引可读且存在匹配层 | 标记 unavailable；继续使用仓库/OpenSpec 约束 |
| `workspace_memory` | 能确定 developer identity 且对应 workspace 索引可读 | 标记 unavailable；不猜测多个 workspace 的归属 |
| `injected_context` | Trellis hook/平台已提供可验证的上下文路径 | 不依赖注入内容，直接读取已知文件 |
| `check` | 当前技能目录存在 `trellis-check` 且 Phase 3 writer 权限允许 | 不运行 Trellis check，仍执行 dev-flow 测试矩阵 |

入口/恢复把能力向量、读取路径、失败原因和当前 task 标识写入 `capability_context`。检测阶段只读取文件和运行时已注入的路径，禁止执行未知 `.trellis/scripts/`；规划只在 `task_context` 可用时引用已有 PRD；执行前只在 `spec_context` 可用时读取适用规范；`trellis-check` 可能修复文件，因此只能作为 Phase 3 中受 Git/writer 边界约束的独立任务运行，其输出再作为补充证据。无当前任务、无匹配 spec、多个 workspace 无法归属或文件不可读都必须记录为局部降级，不阻断标准 dev-flow。

验收后可以提出更新 Trellis spec。dev-flow 不直接执行 task archive、journal 或外部同步：`dev-flow-master` 只记录 `lifecycle_handoff`（建议动作、目标、用户决定、当前 Git 状态），用户明确触发的 Trellis command/skill 才是这些写入的执行所有者；其中涉及提交、分支和回滚的部分还必须遵守 `dev-flow-git`。Trellis handoff 的成功/失败记录在 Trellis 自身 task/workspace 与 `capability_context.lifecycle_handoff_result`；部分成功时重新读取实际状态、逐项报告已完成和未完成动作，不自动重试，也不回退已完成动作。该 handoff 位于 `acceptance_ready` 之后，不影响已经成立的 dev-flow 完成结论。

### 4. 明确双制品优先级和去重

规范权威和事实证据采用两条不同的顺序：

- **规范权威：**已批准的 OpenSpec/dev-flow requirement、design、acceptance 和 gate > 已被这些制品显式引用的 Trellis PRD/spec > 未采纳的 Trellis 项目上下文 > 聊天记忆。
- **事实证据：**实际 Git/文件系统与 fresh 命令输出 > 持久化执行状态 > Trellis task/workspace 状态 > 聊天记忆。

事实状态与规范基线不一致时，事实用于证明发生了漂移，但不得改写规范；系统必须修复实现或按 requirement change 重新进入规划。Trellis PRD/spec 与 OpenSpec 重叠时使用路径引用和覆盖映射，不复制整份内容；若两者冲突，停止并返回相应 gate。

### 5. 用发布面扫描与语义要求形成防回归

`doctor` 增加两类检查：

1. 通过 `npm pack --dry-run --json --ignore-scripts --loglevel=silent` 获取 npm 实际解析后的 `files[].path`，因此 package glob、默认包含、忽略规则和未来新增扩展名都由 npm 决定。逐个以 Buffer 读取所有发布文件，对 ASCII 字节执行大小写归一化后搜索遗留标识；不区分文本、未知扩展名、无扩展名或二进制。pack 非零、JSON 无效、路径逃逸、文件不存在或读取失败都 fail closed，并输出相对路径或故障原因。检测词在实现中由中性片段组合，避免发布文档重新出现完整旧名称。
2. 要求 master/planning/debugging/execution/acceptance 的聚合语义同时包含 Grill-me、Trellis 条件检测、本地 TDD、本地根因分析和 evidence-before-claim 契约。

负向行为测试由 `scripts/test-retired-workflow-guard.mjs` 使用 Node 内置模块完成：从同一分片在内存构造 mixed-case 目标，并为 discover、load、route、invoke、recommend、required、optional、fallback 八类动作逐一在 `docs/`（已被 `package.json.files` 覆盖）写入临时 fixture；每一类都断言 doctor 非零和路径命中，再在 `finally` 删除 fixture。scanner 与测试脚本自身都必须保持完整标识零命中。最终独立仓库搜索作为第二条证据链。

### 6. 源文件先改，镜像机械同步

先修改 `skills/`、`commands/`、文档和 CLI，再将核心技能与命令机械同步到 `.opencode/` / Claude 命令表面。`doctor` 的镜像哈希与命令 parity 检查是强制验收项。

## Risks / Trade-offs

- **Trellis 与 OpenSpec 内容冲突** → 区分规范权威与事实证据，使用路径映射和 requirement-change 回退。
- **Trellis 版本或命令表面变化** → 依赖稳定的文件存在性与能力描述，不把具体版本命令设为必需条件。
- **发布面扫描误报** → 扫描所有发布文件原始字节并输出具体命中路径；若二进制偶然包含完整 ASCII 标识也按发布残留处理。
- **完整旧标识不写入源码使测试构造较隐晦** → 在 CLI 中使用带解释的中性片段组合，并以行为测试证明拦截有效。
- **历史 CHANGELOG 被改写** → 仅将旧品牌表述泛化，不删除版本事实或行为变化记录。
- **可选适配导致流程分支增加** → 在 master 的单一集成参考中集中定义检测、所有权和阶段矩阵。

## Migration Plan

1. 保留基线测试记录：旧引用计数、doctor 漏检、Grill-me/Trellis 零接入。
2. 新增 master 集成参考并更新规划、调试、执行、验收、Loop 的本地契约。
3. 更新 CLI 必需语义和发布面遗留扫描。
4. 更新 README、工作流说明、安装说明、CHANGELOG 和三套命令表面。
5. 机械同步 OpenCode 镜像，运行格式/语义/镜像检查。
6. 运行无旧外部流程包、有 Trellis与无 Trellis的前向场景。
7. 运行 OpenSpec validate、Node 语法检查、doctor、dry-run 安装和 npm pack 检查。

回滚方式：在未提交前按文件反向应用补丁；提交后使用普通 revert。不得使用破坏性重置。

## Test Plan

- **RED 基线**：当前 `doctor` 成功但发布面仍存在遗留标识；当前场景不会调用 Grill-me/Trellis。
- **静态零引用**：大小写不敏感搜索整个 Git 跟踪文本；doctor 解析 npm dry-run 的真实 `files[].path` 并扫描全部文件原始字节，期望零命中；pack/JSON/路径/读取失败均判失败。
- **遗留扫描负测**：运行 Node 测试脚本，在 `docs/` 创建 mixed-case 临时 fixture，期望 doctor 非零且报告该路径；无论断言成败都在 `finally` 清理，随后确认 doctor 恢复通过。
- **CLI 语法**：`node --check bin/dev-flow.mjs` 成功。
- **治理语义**：`npm run doctor` 成功，并显示遗留依赖检查、Grill-me/Trellis 集成契约、镜像和命令 parity 通过。
- **安装 dry-run**：`npm run dry-run:local` 与 `npm run dry-run:global` 成功且不写入目标。
- **OpenSpec**：`openspec validate integrate-grill-trellis` 成功。
- **规划场景**：无外部旧流程包、有 Grill-me/Trellis 时，规划读取 Trellis 上下文并用 Grill-me 收敛，但仍产出 OpenSpec/dev-flow gate；Grill-me 加载失败或用户中止时记录原因并续用本地规则。
- **已安装但不触发场景**：向独立 subagent 提供包含遗留流程能力的运行时目录和 dev-flow 原始技能，按 `trigger_trace` 逐项记录八类动作；期望 `source: dev-flow` 的目标匹配事件为零，所有必需阶段只指向本地契约、Grill-me 或 Trellis。
- **完全未安装场景**：在不提供遗留流程能力的独立上下文中依次演练规划、调试、执行和验收；期望没有缺失依赖、降级警告、安装要求或未解析的外部技能调用。
- **Trellis 能力矩阵**：分别验证无 `.trellis/`、`.trellis/` 存在但 workflow 缺失或不可读、仅 workflow、无当前 task、无匹配 spec、多个 workspace 无法归属；每种情况只降级对应能力，检测阶段不执行未知脚本。
- **交付场景**：调试、TDD、完成前验证均选择本地强制契约；Trellis check 仅作为补充证据。
- **语义负测**：分别移除 Grill-me、Trellis、本地调试、TDD、fresh verification 必需短语，期望 `doctor` 明确失败。
- **副作用场景**：dev-flow 只记录 handoff；未由用户显式触发 Trellis command/skill 时不写入。模拟 handoff 部分成功，期望重新读取状态、记录逐项结果且不自动重试。
- **恢复场景**：会话恢复后重新检测能力；路径、当前 task 或用户批准发生变化时废止旧 `capability_context` 和旧 lifecycle handoff 授权。

## Open Questions

无阻塞问题。用户已确认全局安装、禁用和卸载由其按需处理，不纳入本次项目变更。
