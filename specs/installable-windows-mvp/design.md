# 可安装 Windows MVP：技术设计

## 1. 设计结论

本轮采用 Rust 侧 SQLite 仓储，而不是把任意 SQL 执行权限暴露给 WebView。前端只调用 `load_app_state`、`save_app_state`、`migrate_legacy_state`、`reset_app_state` 和诊断命令；Rust 在单一事务中验证并写入完整状态。

这样可以同时满足：参数化 SQL、事务原子性、最小 Tauri 权限、跨窗口共享状态和迁移失败回滚。

`data-model-creation` 建议简单、明确的 SQL 场景不要使用复杂建模工具，因此本设计保持五张核心表和一张备份表，不引入企业级 ER 模型。

## 2. 本机基线

设计时实测：

- Windows NT 10.0.26200.0，AMD64。
- Node.js 24.15.0、npm 11.12.1、winget 1.29.290 已安装。
- WebView2 151.x 已安装。
- Rust、Cargo、rustup 未安装。
- Visual Studio Installer 和 C++ Build Tools 未安装。
- C、D 盘空间满足构建要求。

因此只需安装 Rust stable MSVC 和 Visual Studio 2022 Build Tools 的 Desktop C++ 工作负载，不重复安装 WebView2。

## 3. 架构边界

```text
AppController / Popup / Floating
              │
              ▼
      StatePersistence interface
        ┌───────────────┴───────────────┐
        ▼                               ▼
BrowserLocalStorageRepository     TauriSqliteRepository
                                        │ invoke only
                                        ▼
                              Rust state_repository.rs
                                        │
                                        ▼
                           app-data/tanyue.sqlite3
```

- `src/persistence.ts`：定义异步仓储接口、串行写入协调器和浏览器回退。
- `src/desktop.ts`：只封装受限 Tauri invoke，不包含 SQL。
- `src/store.ts`：继续保存纯领域状态变换，不直接访问具体存储。
- `src/app.ts`：启动时等待仓储初始化，提交时排队持久化。
- `src-tauri/src/state_repository.rs`：数据库路径、schema、事务、序列化、备份和 Tauri commands。
- `src-tauri/src/lib.rs`：注册仓储命令，不给 WebView shell 或任意文件系统权限。

## 4. SQLite schema v1

数据库位于 Tauri `app_data_dir`：

```text
<app-data>/tanyue.sqlite3
<app-data>/backups/localstorage-v1-<timestamp>-<sha256>.json
```

### 4.1 app_state

单例行，保存跨实体导航和设置：

```sql
app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  active_book_id TEXT NOT NULL,
  current_segment_id TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  selected_view TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  onboarding_complete INTEGER NOT NULL CHECK (onboarding_complete IN (0, 1))
)
```

### 4.2 books

```sql
books (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
)
```

完整 Book JSON 保存在 `payload_json`，必要的标识、顺序和查询字段单独建立约束。

### 4.3 segments

```sql
segments (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL UNIQUE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  status TEXT NOT NULL CHECK (status IN ('unread', 'shown', 'confirmed')),
  favorite INTEGER NOT NULL CHECK (favorite IN (0, 1)),
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (book_id, sequence)
)
```

`payload_json` 包含不可变原文、来源 runs、处理追溯、笔记和时间字段。索引覆盖 `book_id/status/favorite`。

### 4.4 reading_events

```sql
reading_events (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  book_id TEXT,
  segment_id TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
)
```

事件引用允许为空；删除来源时历史事件是否保留由后续产品决策处理，本轮全量状态保存不会产生悬空引用。

### 4.5 persistence_meta

```sql
persistence_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

记录 schema、最近成功保存时间和 LocalStorage 迁移标记。

### 4.6 migration_backups

```sql
migration_backups (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  backup_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  book_count INTEGER NOT NULL,
  segment_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT NOT NULL
)
```

迁移原 JSON 同时保存在 `backups/` 文件中；数据库只保存路径、校验和和计数，不重复存大文本。

## 5. 数据写入与读取

### 5.1 保存

前端发送完整 `AppState` JSON。Rust：

1. 将 JSON 解析为最小强类型持久化 DTO，拒绝缺失 books/segments/events 或非法 schema。
2. 验证 book id 唯一、segment id 唯一、segment 的 bookId 存在、每本 sequence 连续。
3. 开启 `IMMEDIATE` transaction。
4. 按 events → segments → books 顺序清理旧快照。
5. 使用参数化语句批量插入 books、segments、events。
6. upsert `app_state` 和 `persistence_meta`。
7. 提交；任一步失败自动回滚。

当前应用状态规模下，全量快照写入更容易证明一致性。前端协调器会串行并合并连续保存请求，避免滑块或快速点击产生并发事务。后续若数据量增长，再在不改变仓储接口的前提下改成增量写入。

### 5.2 读取

Rust 按 position/sequence 读取 payload JSON，重新组装 AppState，并再次验证关键引用。数据库为空时返回 `null`，不得自动把 demo 数据伪装成已有用户数据。

### 5.3 浏览器回退

普通浏览器继续使用现有 LocalStorage。`BrowserLocalStorageRepository` 接受可注入的 Storage 接口，以便测试损坏 JSON、保存失败和 reset。

## 6. 一次性迁移

Tauri 首次启动顺序：

1. 打开数据库并执行 schema migration。
2. 若数据库已有 `app_state`，直接读取，不再检查旧数据。
3. 若数据库为空，查找 `tanyue.state.v1`，再查 legacy key。
4. 有合法旧状态时调用 `migrate_legacy_state(sourceKey, stateJson)`。
5. Rust 先在 app-data/backups 写 UTF-8 临时文件，flush 后原子 rename，并计算 SHA-256。
6. 在 SQLite transaction 中导入状态、写 migration_backups 和迁移 meta。
7. 重新读取数据库并比较书籍数、片段数、当前 id、收藏数、笔记数和 confirmed 数。
8. 全部一致后，前端只写 `tanyue.sqlite.migrated.v1` 标记；原 LocalStorage 正文不删除。

如果任一步失败，SQLite transaction 回滚；备份文件和原 LocalStorage 保留。重复调用同一 sourceKey 返回 `already_migrated`，不重复插入。

没有旧状态时，将 demo state 作为首次数据库快照保存，但不写“旧数据已迁移”记录。

## 7. 前端生命周期

- `AppController` 构造函数只创建安全 fallback state；`start()` 首先 `await persistence.initialize()`，再渲染和启动调度器。
- `commit()` 返回 Promise，并交给 `PersistenceCoordinator` 串行保存；UI 可先更新，但保存失败必须 toast 明确提示。
- 会立即关闭独立弹窗的操作必须等待保存完成后再关闭窗口。
- 跨窗口 `state-changed` 事件触发仓储重新读取，而不是直接读取 LocalStorage。
- `beforeunload` 不承担数据库正确性；关键操作在关闭之前已等待持久化。

## 8. Rust 与 Tauri 接入

- 新增 `rusqlite`（bundled SQLite）和 `sha2`，由 Cargo.lock 固定版本。
- Rust plugin 初始化不增加任意 SQL、shell 或广泛文件权限。
- 数据库 commands 只接受/返回 JSON 字符串、迁移来源 key 和非敏感诊断信息。
- `state_repository.rs` 中数据库路径只通过 Tauri `app_data_dir` 解析，并验证备份目录位于其下。
- `tauri.conf.json` bundle targets 收敛为 NSIS，避免为本轮额外要求 VBSCRIPT/WiX。

## 9. 自动化测试

### TypeScript

- 浏览器 LocalStorage 往返与损坏回退。
- PersistenceCoordinator 连续提交只串行执行，失败可观察。
- 旧片段追溯回填继续通过。
- popup 显式确认保存完成后才关闭的行为测试到可分离的协调函数层。

### Rust

使用内存 SQLite 或临时目录测试：

- schema v1 幂等创建。
- AppState JSON 保存/读取往返。
- 非连续 sequence、未知 bookId 和重复 id 被拒绝。
- 保存中途失败后旧快照仍完整。
- LocalStorage 迁移幂等。
- 迁移失败时数据库不出现半成品，备份文件仍存在。

## 10. 工具链安装与打包

安装步骤遵循官方来源：

1. `winget install --id Microsoft.VisualStudio.2022.BuildTools`，只选择 `Microsoft.VisualStudio.Workload.VCTools` 及推荐的 x64/x86 MSVC 和 Windows SDK。
2. `winget install --id Rustlang.Rustup`。
3. 新终端环境中执行 `rustup default stable-msvc`、添加 rustfmt，并验证 x86_64 MSVC host。
4. 运行 `npm run verify`、`cargo fmt --check`、`cargo test`、`cargo check`。
5. 运行 `npm run tauri:build -- --bundles nsis`。
6. 校验安装包存在且非空，使用 NSIS 当前用户安装方式安装。
7. 启动已安装应用，确认进程、主窗口和数据库文件存在。

若创建可重复安装辅助脚本，依据 `windows-encoding-rules` 使用纯 ASCII PowerShell 5.1 语法，避免中文代码页和 BOM 差异。

## 11. 真机验收记录

自动化可验证编译、数据库与进程；以下需真实桌面观察并在状态文档中区分：

- 主窗口关闭到托盘。
- 悬浮入口显示、点击和恢复。
- 阅读弹窗在记事本持续输入时不抢焦点。
- 托盘退出结束进程。
- 已安装应用重启后 SQLite 数据保持。

无法可靠自动观察焦点的项目不得仅凭源码标为通过。

## 12. 官方依据

- Tauri Windows prerequisites: https://v2.tauri.app/start/prerequisites/
- Tauri Windows installer: https://v2.tauri.app/distribute/windows-installer/
- Rust official installer: https://www.rust-lang.org/tools/install/
