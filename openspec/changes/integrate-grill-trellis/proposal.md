## Why

当前 dev-flow 在规划、调试、执行、验收、Loop、文档和 CLI 校验中仍显式引用一个外部旧流程包。虽然部分阶段已有本地降级协议，但发布内容与校验器仍把该外部包当作优先依赖，也没有 Grill-me/Trellis 的确定性接入方式，导致可移植性、流程一致性和防回归能力不足。

## What Changes

- 删除源技能、OpenCode 镜像、命令、安装说明、中英文文档、历史说明和 CLI 语义检查中的全部旧流程包引用。
- 即使运行时已安装旧流程包，dev-flow 发布内容也不得发现、加载、路由、调用、推荐或要求其中任何技能。
- 将 dev-flow 的根因分析、每任务 TDD、证据式完成验证确立为本地强制契约，不依赖外部技能存在。
- 新增 Grill-me 适配规则，用于模糊需求、架构取舍和高风险设计的逐分支澄清；其输出必须进入 OpenSpec/dev-flow 制品。
- 新增 Trellis 条件适配规则：仅在项目已初始化 `.trellis/` 时读取任务、PRD、spec、workflow 和 workspace 上下文，并在执行前检查、质量检查和知识沉淀阶段协作。
- 明确 OpenSpec/dev-flow 与 Trellis 的所有权、优先级、去重、恢复和 Git 副作用边界，避免双重事实源。
- 扩展 `doctor`，对发布面执行大小写不敏感的遗留引用检查，并要求 Grill-me/Trellis 集成语义存在。
- 增加遗留流程能力已安装但项目零触发、完全未安装仍完成全阶段、有/无 Trellis 的前向场景验证。
- 明确全局技能安装、禁用和卸载不属于本项目变更范围，由用户按需处理。

## Capabilities

### New Capabilities

- `workflow-capability-adapters`: 定义 Grill-me 与 Trellis 的检测、阶段映射、制品优先级、降级和副作用边界。
- `dependency-decoupling-guard`: 定义自包含质量契约、全发布面零引用要求和 doctor 防回归行为。

### Modified Capabilities

无。当前项目尚无已发布的 OpenSpec capability spec。

## Impact

- 核心技能：`dev-flow-master`、`dev-flow-planning`、`dev-flow-debugging`、`dev-flow-execution`、`dev-flow-acceptance`、`dev-flow-loop`。
- 发布镜像与命令：`.opencode/skills/`、`.opencode/command/`、`commands/`、`commands/claude/`。
- CLI 与验证：`bin/dev-flow.mjs` 的必需语义和遗留模式检查。
- 用户文档：`README.md`、`README.zh-CN.md`、`docs/workflow-overview.md`、`.codex/INSTALL.md`、`CHANGELOG.md`。
- 不新增运行时依赖，不复制 Grill-me/Trellis 源码，不改变 OpenSpec 和 dev-flow 门禁所有权。
