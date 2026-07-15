## ADDED Requirements

### Requirement: 发布面不得包含遗留依赖标识
源代码、技能、参考文档、命令、安装说明、CHANGELOG、镜像和 npm 发布的任意文件字节 MUST 不包含大小写不敏感的完整 ASCII 遗留依赖标识。

#### Scenario: 干净的发布候选
- **WHEN** 维护者运行仓库搜索和 npm dry-run 发布面检查
- **THEN** 两项检查均返回零命中

#### Scenario: 遗留标识被重新加入
- **WHEN** 任一发布文本重新出现完整遗留依赖标识
- **THEN** `doctor` 失败并报告具体文件

#### Scenario: 大小写变体与扫描故障
- **WHEN** 任意发布文件包含大小写混合标识，或 npm pack、JSON、路径校验、文件读取失败
- **THEN** 检查以非零状态失败并报告命中路径或故障原因，不把扫描失败当作零命中

#### Scenario: 未知扩展名、无扩展名或二进制资产
- **WHEN** npm dry-run 文件列表包含未知扩展名、无扩展名、视频或工作簿
- **THEN** 扫描器仍读取原始字节并执行 ASCII 大小写不敏感扫描，不按扩展名跳过

### Requirement: dev-flow 不得触发遗留流程能力
遗留目标 MUST 由分片 `super` 与 `power` 按 ASCII 大小写不敏感子串规则识别，分片连接结果 MUST NOT 持久化到仓库。dev-flow 发布内容 MUST NOT 包含发现、加载、路由、调用、推荐、必需子技能、可选助手或可用时回退到该目标的指令。该约束 MUST 在相应能力已安装和未安装两种环境中同时成立。

#### Scenario: 运行时已安装遗留流程能力
- **WHEN** 运行时技能目录同时包含遗留流程能力、Grill-me 和 Trellis，用户只调用 dev-flow
- **THEN** dev-flow 来源的 discover、load、route、invoke、recommend、required、optional 和 fallback 八类目标匹配事件全部为零，只使用本地契约、Grill-me 或条件启用的 Trellis

#### Scenario: 运行时未安装遗留流程能力
- **WHEN** 用户在没有遗留流程能力的环境中运行完整 dev-flow
- **THEN** 所有阶段正常完成，不出现缺失依赖、降级警告或安装要求

#### Scenario: 平台全局政策独立触发
- **WHEN** agent 平台在没有 dev-flow 指令的情况下自行加载一个全局技能
- **THEN** 事件记录 `source: platform_global` 与外部 instruction path；dev-flow 不得修改全局技能目录或输出安装、禁用、卸载建议，且仍不得产生八类目标匹配指令

### Requirement: 根因分析必须由本地契约保证
`dev-flow-debugging` MUST 直接要求复现、证据收集、根因假设、最小修复和回归验证，不得依赖外部调试技能存在。

#### Scenario: 没有外部调试助手
- **WHEN** 用户报告回归且环境没有外部调试技能
- **THEN** 系统仍完整执行本地根因协议并产生 `debugging_report`

### Requirement: 每任务 TDD 必须由本地契约保证
每个行为变更任务 MUST 执行失败测试、观察 RED、最小 GREEN、绿后重构和证据记录，除非用户明确批准例外。

#### Scenario: 正常实现任务
- **WHEN** Phase 3 实现一个行为变更
- **THEN** 任务完成信号包含 RED、GREEN、重构结果或经批准的例外，不包含外部技能模式依赖

### Requirement: 完成声明必须基于新鲜证据
任务、批次和最终交付的完成声明 MUST 先运行能够证明结果的命令或浏览器检查，读取新输出，并仅报告证据支持的结论。

#### Scenario: 实现者报告成功
- **WHEN** 实现者准备声明任务完成
- **THEN** 系统在声明前重新运行证明性检查，并把命令与结果写入本地验证证据

### Requirement: doctor 必须验证解耦语义
`doctor` MUST 同时验证遗留标识和遗留命名空间调用不存在、Grill-me/Trellis 适配契约可发现、本地调试/TDD/验收语义存在，以及源技能与发布镜像一致。

#### Scenario: 所有契约完整
- **WHEN** 维护者运行 `npm run doctor`
- **THEN** 遗留扫描、能力适配、本地质量契约、镜像和命令 parity 均通过

#### Scenario: 适配语义缺失
- **WHEN** Grill-me 或 Trellis 的必要阶段规则从源技能中删除
- **THEN** `doctor` 因必需语义缺失而失败

#### Scenario: 八类 no-trigger 负向 fixture
- **WHEN** 测试脚本逐一生成 discover、load、route、invoke、recommend、required、optional 或 fallback 的目标匹配 fixture
- **THEN** 每一类都使 `doctor` 非零并报告路径，且 fixture 无论测试结果如何都被恢复清理

#### Scenario: 本地质量语义缺失
- **WHEN** 本地根因分析、每任务 TDD 或 fresh evidence-before-claim 任一必需语义被删除
- **THEN** `doctor` 指出缺失语义并失败

### Requirement: 变更不得新增运行时依赖
本次解耦 MUST 不复制外部技能源码、不安装 Trellis 到发行仓库，也不新增 npm 运行时依赖。

#### Scenario: 检查发布元数据
- **WHEN** 维护者比较变更前后的 `package.json` 与发布文件列表
- **THEN** 运行时依赖保持不变，新增内容仅为 OpenSpec/dev-flow 制品和本地集成规则
