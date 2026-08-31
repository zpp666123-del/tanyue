# Implementation Plan

- [x] 1. 建立持久化测试门禁
  - 先为浏览器仓储、异步保存队列、损坏数据回退和迁移选择逻辑编写失败测试。
  - 为 Rust schema、状态往返、引用校验、事务回滚和迁移幂等编写单元测试。
  - 保持现有 16 项文本导入与状态语义测试。
  - _Requirement: R2, R3, R6_

- [x] 2. 实现前端持久化抽象与浏览器回退
  - 增加 `StatePersistence`、`BrowserLocalStorageRepository` 和串行保存协调器。
  - 区分“没有旧状态”和“使用 demo fallback”，为迁移提供原始 LocalStorage 探测。
  - 让保存失败可观察并保持现有浏览器预览行为。
  - _Requirement: R2, R3, R6_

- [x] 3. 实现 Rust SQLite 仓储与 schema v1
  - 增加受限 Tauri commands、应用数据目录数据库和版本化 schema。
  - 用参数化 SQL 和事务实现完整状态保存、读取、重置与一致性校验。
  - 增加必要外键、唯一约束、检查约束和索引。
  - 增加 Cargo.lock 并记录新增依赖许可。
  - _Requirement: R2, R5, R6_

- [x] 4. 实现 LocalStorage 迁移与备份
  - 迁移前在 app-data/backups 创建 UTF-8 原始 JSON 备份和 SHA-256。
  - 在单一数据库事务中导入旧状态并记录迁移元数据。
  - 验证书籍、片段、进度、收藏、笔记、计划和设置计数/值一致。
  - 验证重复启动不重复迁移，失败时保留旧 LocalStorage 和备份。
  - _Requirement: R3_

- [x] 5. 接入 AppController、弹窗与跨窗口同步
  - 应用启动时等待仓储初始化再渲染和启动调度。
  - 所有 commit 通过串行协调器保存；错误向用户明确提示。
  - 弹窗关闭前等待关键阅读状态保存完成。
  - 跨窗口状态事件重新读取 SQLite；浏览器模式继续读取 LocalStorage。
  - _Requirement: R2, R4_

- [x] 6. 安装 Windows 原生构建工具链
  - 使用 winget 安装 Visual Studio 2022 Build Tools 的 Desktop C++ 工作负载。
  - 使用官方 rustup 安装 stable MSVC、Cargo 和 rustfmt。
  - 不重复安装已存在的 WebView2，不添加无关工作负载。
  - 记录实际版本和安装结果。
  - _Requirement: R1_

- [x] 7. 完成自动化与原生工程验证
  - 运行 `npm run verify`、`cargo fmt --check`、`cargo test` 和 `cargo check`。
  - 修复前端、Rust、Tauri capabilities 和 bundle 配置中的全部阻塞。
  - 检查领域层无新增 `any`，数据库失败不会静默成功。
  - _Requirement: R1, R5, R6_

- [x] 8. 构建并安装 Windows 应用
  - 构建 NSIS 当前用户安装包并校验文件存在、大小和架构。
  - 安装“弹阅”，记录安装包和安装路径。
  - 启动已安装应用，确认进程、主窗口和 SQLite 文件创建。
  - 验证重新启动后状态仍保留。
  - _Requirement: R5_

- [ ] 9. 执行核心桌面验收并更新状态
  - 验证关闭到托盘、托盘退出、悬浮入口、弹窗恢复和错过提醒不补弹。
  - 尽可能使用记事本持续输入验证弹窗不抢焦点；无法自动确认的观察项明确标注。
  - 更新 `PROJECT_STATUS.md`、README 和本任务清单，区分自动化通过、人工通过和发布非目标。
  - _Requirement: R4, R6_

  已完成主窗口关闭后驻留、悬浮入口、阅读弹窗恢复、已安装版启动/SQLite/界面检查与状态文档更新；记事本持续输入的不抢焦点、托盘菜单退出、休眠恢复和多显示器仍需单独人工验收。
