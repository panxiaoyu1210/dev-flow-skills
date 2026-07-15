## 1. 集成契约与路由

- [x] 1.1 新增 `skills/dev-flow-master/references/capability-adapters.md`，定义 Grill-me/Trellis 精确发现、Trellis 能力向量、阶段矩阵、规范/事实优先级、局部降级和生命周期副作用边界；先用基线场景确认当前规则无法发现两项能力。
- [x] 1.2 更新 `skills/dev-flow-master/SKILL.md`、`references/routing-and-complexity.md` 与 `references/flow-and-recovery.md`，删除旧依赖政策并把 capability adapter 纳入入口、恢复与 guardrail。
- [x] 1.3 更新 `skills/dev-flow-planning/references/phase-1-documents.md`，用 Grill-me 澄清与 Trellis PRD/spec 引用替代旧规划助手，同时保持 OpenSpec Baseline Gate 所有权。
- [x] 1.4 更新 `skills/dev-flow-master/references/state-and-gates.md`，定义 `capability_context` 的持久化字段、重新检测规则和 Trellis 生命周期独立批准记录。

## 2. 本地质量契约

- [x] 2.1 更新 `skills/dev-flow-debugging/SKILL.md`，直接要求本地复现、根因与回归协议；在 Trellis-aware 项目读取相关 spec/task 作为证据上下文。
- [x] 2.2 更新 `skills/dev-flow-execution/SKILL.md`、`references/task-settlement-and-modes.md` 与 `references/replanning-and-recovery.md`，将 RED/GREEN/重构和 fresh evidence-before-claim 设为唯一必需模式，并加入 Trellis 执行前 spec/check 补充证据。
- [x] 2.3 更新 `skills/dev-flow-acceptance/SKILL.md`，将本地 fresh verification 设为完成前硬门禁，并约束 Trellis check/update/finish 的证据与副作用边界。
- [x] 2.4 更新 `skills/dev-flow-loop/SKILL.md` 与 `references/control-plane.md`，统一使用 dev-flow 本地每任务 TDD 契约。

## 3. CLI 防回归（RED → GREEN）

- [x] 3.1 记录 RED：`npm run doctor` 在发布面仍有遗留标识时错误返回成功；记录当前引用计数和 Grill-me/Trellis 零接入结果。
- [x] 3.2 修改 `bin/dev-flow.mjs`：用 `npm pack --dry-run --json --ignore-scripts --loglevel=silent` 取得真实 `files[].path`，校验路径后扫描所有文件原始字节的 ASCII 大小写变体；pack/JSON/路径/读取失败即失败并报告，scanner 源码不得包含完整旧标识。
- [x] 3.3 更新 CLI 治理必需语义：Grill-me/Trellis capability context、本地根因分析、每任务 TDD、fresh evidence-before-claim 和 Loop 表述。
- [x] 3.3a 增加项目级 no-trigger 语义检查：用 `identifier_fragments: ["super", "power"]` 在内存识别目标；dev-flow 聚合内容不得包含目标的 discover、load、route、invoke、recommend、required、optional 或 fallback。
- [x] 3.4 新增 `scripts/test-retired-workflow-guard.mjs` 与 `package.json` 测试脚本：从分片构造 mixed-case 目标，在 `docs/` 为八类动作逐一创建 fixture，逐类断言 doctor 非零且报告路径，并用 `finally` 必然清理；随后运行 `node --check bin/dev-flow.mjs` 和该负测。
- [x] 3.5 分别临时删除或替换 Grill-me、Trellis、本地调试、TDD、fresh verification 必需短语，确认 doctor 对每类缺失语义失败，再恢复文件。

## 4. 发布表面同步

- [x] 4.1 更新 `README.md`、`README.zh-CN.md`、`docs/workflow-overview.md`、`.codex/INSTALL.md` 与 `CHANGELOG.md`，说明自包含核心和 Grill-me/Trellis 可选适配。
- [x] 4.2 更新 `commands/dev-flow-loop.md` 与 `commands/claude/dev-flow-loop.md` 的本地 TDD 表述。
- [x] 4.3 将 `skills/` 与命令变更机械同步到 `.opencode/skills/` 和 `.opencode/command/`，不得引入与源文件不同的语义修改。

## 5. 验证与前向测试

- [x] 5.1 运行大小写不敏感的 Git 跟踪文本搜索；由 doctor 解析 npm dry-run 的实际文件列表并扫描全部文件原始字节，确认完整遗留标识为零命中，pack/JSON/路径/读取失败均判失败。
- [x] 5.2 运行 `npm run doctor`、`npm run dry-run:local`、`npm run dry-run:global` 与 `openspec validate integrate-grill-trellis`，确认语义、镜像、命令、安装边界和 OpenSpec 全部通过。
- [x] 5.3 用独立规划场景验证 Grill-me 可用、不可发现、加载失败和用户中止四种状态；期望均记录 `capability_context`，后三种续用本地规则。
- [x] 5.3a 用 `trigger_trace` 独立来源追踪场景验证：运行时目录即使含遗留流程能力，dev-flow 导致的八类目标匹配事件仍为零；平台全局独立触发必须标为 `platform_global`，且不得修改全局目录或输出全局技能管理建议。
- [x] 5.3b 在完全未安装遗留流程能力的独立上下文中演练规划、调试、执行和验收，断言无缺失依赖、降级警告、安装要求或未解析外部调用。
- [x] 5.4 用独立 Trellis 场景分别验证无 `.trellis/`、目录存在但 workflow 缺失/不可读、仅 workflow、无当前 task、无匹配 spec 和多个 workspace；期望只降级对应能力且检测阶段不执行未知脚本。
- [x] 5.5 用独立交付场景验证调试、TDD、fresh verification 本地契约，Trellis check 仅为补充证据。
- [x] 5.6 用独立副作用场景验证 dev-flow 只记录 handoff；只批准 Git 时不得执行 task archive、journal 或外部同步；模拟用户触发 Trellis 流程后的成功、失败与部分成功结果。
- [x] 5.7 用恢复场景验证会话重启后重新检测能力，并在路径、当前 task 或用户决定变化时废止旧记录和旧 handoff 授权。
- [x] 5.8 汇总变更文件、命令输出、残余风险和 Git 状态，交由 `dev-flow-acceptance` 独立检查后生成交付报告。
