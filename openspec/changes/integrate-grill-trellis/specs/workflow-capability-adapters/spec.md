## ADDED Requirements

### Requirement: 外部能力不得成为运行前提
dev-flow MUST 在 Grill-me、Trellis 或其他外部流程技能不可用时，仍能完成所有核心阶段和验收门禁。

#### Scenario: 目标项目没有外部能力
- **WHEN** 用户在没有 Grill-me 且没有 `.trellis/` 的项目中启动 dev-flow
- **THEN** 系统使用本地澄清、调试、TDD 和验收契约继续执行，不要求安装外部能力

### Requirement: Grill-me 只负责高价值澄清
规划阶段 MUST 通过运行时技能目录按精确名称发现 Grill-me，在需求模糊、存在多种有效方案、架构取舍或高风险假设时优先使用，并 MUST 将状态和结论持久化到 OpenSpec/dev-flow 制品。

#### Scenario: 模糊的跨模块需求
- **WHEN** 一个需求包含多个相互依赖的设计选择且 Grill-me 可用
- **THEN** 系统先从仓库推导可回答信息，再一次提出一个问题并给出推荐答案，最终把决策写入正式制品

#### Scenario: Grill-me 不可用
- **WHEN** 同类需求进入规划但 Grill-me 不存在
- **THEN** `dev-flow-planning` 使用一次一个高价值问题、具体选项和推荐答案的本地等价规则

#### Scenario: Grill-me 加载失败或用户中止
- **WHEN** Grill-me 被发现但读取失败、指令不兼容或用户中止访谈
- **THEN** 系统记录 `load_failed` 或 `declined` 及原因，保留已确认答案，并从最后确认点续用本地澄清规则

### Requirement: Trellis 必须按能力检测
系统 MUST 仅以可读的 `.trellis/workflow.md` 作为 Trellis-aware 入口，并 MUST 通过文件读取或已注入路径独立检测 task、spec、workspace 和 check 能力；检测阶段 MUST NOT 执行未知 Trellis 脚本，任一局部能力缺失不得使其他能力或标准 dev-flow 失败。

#### Scenario: 已初始化 Trellis
- **WHEN** 项目存在可读 workflow，且任务上下文、相关 spec、workspace 或脚本中的一个或多个可用
- **THEN** 系统逐项记录能力状态、引用路径、失败原因和当前 task 标识，只使用实际可用的能力

#### Scenario: 未初始化 Trellis
- **WHEN** 项目没有 `.trellis/`
- **THEN** 系统不创建 Trellis 文件、不报缺失错误，也不降低 dev-flow 交付要求

#### Scenario: Trellis 部分初始化或读取失败
- **WHEN** workflow 可读但无当前 task、无匹配 spec、文件不可读或多个 workspace 无法归属
- **THEN** 系统记录对应能力为 unavailable 或 failed，使用标准 dev-flow 回退，不猜测缺失上下文或执行未知脚本

#### Scenario: Trellis 目录存在但 workflow 不可用
- **WHEN** `.trellis/` 存在但 workflow 缺失或不可读
- **THEN** 系统记录 `mode: unavailable` 并使用标准 dev-flow，不探测或执行其余 Trellis 能力

### Requirement: OpenSpec 和 dev-flow 保持交付所有权
OpenSpec requirements/design/tasks、`dev-flow-state.md`、task orchestration 和已批准 gate MUST 是交付基线；Trellis 内容 MUST 仅作为项目上下文和生命周期补充。

#### Scenario: Trellis PRD 与 OpenSpec 重叠
- **WHEN** 当前 Trellis task 已有 PRD 且 dev-flow 需要建立 OpenSpec change
- **THEN** 系统引用 PRD 路径并建立覆盖映射，不复制同义内容或创建第二个事实源

#### Scenario: 两类制品冲突
- **WHEN** Trellis 内容与已批准 OpenSpec requirement 或 acceptance 冲突
- **THEN** 系统停止当前推进并按 requirement change 返回规划和相应 gate

### Requirement: Trellis 阶段动作必须受副作用边界约束
系统 MUST 将 Trellis 的执行前规范读取和质量检查作为可选增强。`dev-flow-master` MUST 记录 task 归档、journal 文件写入或外部同步的独立用户批准；涉及提交、分支或回滚的部分还 MUST 经过 `dev-flow-git`。

#### Scenario: 执行前读取规范
- **WHEN** Trellis-aware 项目的 `spec_context: available` 且即将修改某个 package/layer
- **THEN** 实现者读取相关 Trellis spec，并把约束记录到任务上下文或验证证据

#### Scenario: 执行前没有适用规范
- **WHEN** Trellis-aware 项目的 `spec_context` 为 unavailable 或 failed
- **THEN** 实现者继续使用 OpenSpec、仓库现有模式和测试矩阵，不把缺失 Trellis spec 当作阻塞

#### Scenario: Trellis check 可能写入
- **WHEN** `trellis-check` 可用且其流程允许直接修复文件
- **THEN** 系统只能在 Phase 3 已批准 writer 边界内把它作为任务运行，不得在只读 acceptance 中调用

#### Scenario: 未授权的收尾动作
- **WHEN** acceptance 完成但用户尚未授权提交、归档或 journal 写入
- **THEN** 系统只提出后续动作，不执行 Trellis finish 类副作用

#### Scenario: 只批准 Git 提交
- **WHEN** 用户批准代码提交但没有批准 Trellis task 归档、journal 或外部同步
- **THEN** `dev-flow-git` 可以处理获批提交，但系统不得执行未单独批准的 Trellis 生命周期写入

#### Scenario: 用户触发生命周期 handoff
- **WHEN** acceptance 后用户明确调用或批准 Trellis command/skill 执行归档、journal 或外部同步
- **THEN** Trellis 流程拥有具体写入，dev-flow 记录 handoff 目标与结果；涉及 Git 的部分仍受 `dev-flow-git` 约束

#### Scenario: 生命周期 handoff 部分失败
- **WHEN** Trellis 流程只完成部分获批动作或返回失败
- **THEN** 系统重新读取实际状态，分别记录已完成和未完成动作，不自动重试或回滚已完成动作

### Requirement: 恢复必须区分规范权威与事实证据
恢复流程 MUST 将已批准 OpenSpec/dev-flow 制品作为规范权威，将实际 Git/文件系统和 fresh 命令输出作为事实证据。事实漂移不得自动改写规范；未纳入 OpenSpec 的 Trellis 内容不得覆盖已批准基线。

#### Scenario: 会话恢复时状态不一致
- **WHEN** Trellis task 状态与 `dev-flow-state.md` 或实际 Git 状态不同
- **THEN** 系统用实际状态证明漂移，再按已批准基线修复实现或重进 requirement-change gate，并记录对账结果

### Requirement: 能力上下文必须持久化
进入可选能力检测后，系统 MUST 在 `dev-flow-state.md` 保存 `capability_context`，包括 Grill-me 状态、Trellis mode、逐项能力状态、证据路径、失败原因、当前 task、制品映射和允许的副作用。

#### Scenario: 检测结果跨会话恢复
- **WHEN** 会话重启或上下文压缩后继续同一 dev-flow
- **THEN** 系统重新核对实际能力并更新 `capability_context`；路径、当前 task 或用户决定变化时废止旧能力记录和旧 lifecycle handoff 授权
