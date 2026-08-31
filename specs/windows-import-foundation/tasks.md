# Implementation Plan

- [x] 1. 建立可读、可失败的测试门禁
  - 增加具名测试 harness，逐项输出通过/失败并正确返回退出码。
  - 将现有核心断言迁移为独立测试用例，保持《道德经》81 章基线。
  - 先为文本适配器、覆盖区间、追溯字段、无效导入和展示/确认状态编写失败测试。
  - _Requirement: R5_

- [x] 2. 修复 Windows 构建与验证脚本
  - 用 `fileURLToPath` 修复 `tools/build.mjs`、`tools/test.mjs`、`tools/verify.mjs` 的跨平台根路径。
  - 为 verify 增加清晰阶段输出并传播失败退出码。
  - 安装依赖并生成 `package-lock.json`。
  - 验证失败路径不会写到项目目录之外。
  - _Requirement: R1_

- [x] 3. 建立标准化文档与 SourceAdapter
  - 在领域类型中加入 `DocumentBlock`、`NormalizedDocument`、`SourceAdapter`、适配器错误和追溯模型。
  - 实现 TXT/Markdown 适配器的格式检测、解析、行号锚点、哈希、空输入错误和生命周期方法。
  - 增加适配器注册与选择入口。
  - 保留现有文本解析函数为薄兼容层。
  - _Requirement: R2, R4_

- [x] 4. 实现可证明的拆分与覆盖报告
  - 将超长正文拆成带精确字符 offset 的来源 run。
  - 从来源 run 构造 `Segment.originalText`，保持顺序和原文内容。
  - 实现覆盖校验器和 `CoverageReport`，检测空洞、重叠、乱序、重复引用和空片段。
  - 为新片段写入解析器、拆分器、规则及未应用 AI 的追溯信息。
  - 让所有成功 `ImportResult` 携带有效覆盖报告。
  - _Requirement: R3, R4_

- [x] 5. 接入状态与导入 UI 编排
  - 让 TXT/Markdown 文件导入通过适配器注册表，不在 UI 中保留解析规则。
  - 在写入状态前强制验证覆盖报告；失败时显示明确原因且不写入书架。
  - 成功提示包含覆盖率、正文块数和片段数。
  - 为演示数据和旧 LocalStorage 数据确定性回填 `legacy-unversioned` 追溯信息，保持进度、收藏和笔记。
  - 保持 `shown` 与 `confirmed` 的既有语义。
  - _Requirement: R2, R3, R4, R5_

- [x] 6. 完成质量门禁与状态交付
  - 运行 `npm run verify` 并修复所有失败。
  - 检查 TypeScript 领域层没有新增 `any`。
  - 尝试 Rust/Tauri 检查；环境缺失时如实记录，不伪造通过。
  - 更新 `PROJECT_STATUS.md` 的已完成、未验证和下一 Goal。
  - 回填本清单状态，确保需求、设计、任务与实现相互对应。
  - _Requirement: R1, R6_
