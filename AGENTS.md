# AGENTS.md — 本地 AI/Codex 开发规则

本文件对任何继续开发本项目的 AI 代理生效。开始修改代码前必须先读完。

## 1. 产品总目标

构建一款面向上班族的桌面微阅读工具：导入电子书、文档或网页后，将原文拆成 20～90 秒可读完的完整片段，在合适的工作间隙通过不抢焦点的桌面弹窗呈现，并能够准确接续阅读进度。

## 2. 六条不可破坏的产品不变量

### 2.1 原文不可变

- `Segment.originalText` 必须来源于解析后的原文块。
- AI 结果禁止覆盖 `originalText`。
- AI 可以写入 `helperTitle`、`contextBridge`、`explanation`，且 UI 必须与原文分层。

### 2.2 全量覆盖

- 每个可阅读正文块必须被且只被一个片段覆盖。
- 禁止静默丢段、乱序、重复。
- 每次导入都要生成覆盖率和重复检查结果。

### 2.3 可追溯

每个片段必须有：

- `bookId`
- `sequence`
- `sourceAnchor`
- `contentHash`
- 解析器版本
- 后续 AI 处理时的提示词版本和模型版本

### 2.4 展示不等于阅读

- 自动弹出或自动关闭只能记录 `shown`。
- 只有主动“读完并继续”或明确确认时才记录 `confirmed`。
- 不得为了让指标好看而自动确认。

### 2.5 用户可轻松拒绝

弹窗始终提供：

- 关闭
- 稍后提醒
- 今天暂停
- 展开完整阅读

禁止使用强制全屏、难以找到的关闭按钮或惩罚式打卡。

### 2.6 默认本地和最小权限

- 不内置 API Key。
- 不默认上传原文。
- 不执行 EPUB/网页中的脚本。
- 不申请与当前功能无关的 Tauri 权限。
- 不支持绕过 DRM。

## 3. 非目标

除非用户重新批准，禁止把项目扩张为：

- 重型电子书管理器。
- 书城、内容下载站或盗版分发工具。
- 社交社区、排行榜、连续打卡游戏。
- 通用知识库、知识图谱或团队协作平台。
- ERP、审批系统或复杂后台。
- 首版扫描 PDF/OCR 大平台。
- 首版内置多格式解析平台、在线书库聚合器或常驻 MCP 服务。

## 4. 技术边界

### 4.1 当前技术栈

- Tauri v2
- TypeScript
- 原生 DOM 与 CSS，零前端运行时框架依赖
- 当前演示存储：LocalStorage
- 目标正式存储：SQLite

保持领域逻辑与 UI 分离：

```text
segmenter.ts   只做解析与拆分
scheduler.ts   只做时间计算
store.ts       只做状态和进度
views.ts       只生成界面
popup.ts       只管理阅读卡片生命周期
floating.ts    只管理悬浮图标与位置
app.ts         做交互编排
```

不得把解析规则塞进点击事件或 CSS。

### 4.2 第三方解析器封装

所有第三方库必须通过适配器：

```text
SourceAdapter
  detect(input)
  parse(input) -> NormalizedDocument
  locate(anchor)
  dispose()
```

禁止让 `foliate-js`、`PDF.js`、`Mammoth.js` 的原始对象渗透到领域模型和页面组件。

外部 Agent 的稳定边界是版本化 `.tanyue.json`：Agent 负责解析与提出切片，弹阅必须重新计算字符范围、内容哈希和覆盖率。Agent、CLI 和其他进程禁止直接写 SQLite。

## 5. 每次会话的工作方法

1. 先在 `PROJECT_STATUS.md` 找到当前边界。
2. 只选择一个清晰 Goal。
3. 写下验收标准和不改范围。
4. 先加测试或可重复复现步骤。
5. 实现最小完整纵向链路。
6. 运行 `npm run verify`。
7. 涉及桌面壳时再运行：

```bash
cargo fmt --check
cargo check
npm run tauri:dev
```

8. 更新 `PROJECT_STATUS.md`，不得只汇报“代码已写”。

## 6. P0 优先顺序

1. 在 Windows 真机跑通 Tauri 并修正所有编译问题。
2. 建立 SQLite schema、迁移和 LocalStorage 导入。
3. 建立 `SourceAdapter` 接口。
4. 接入 TXT/Markdown 正式适配器。
5. 稳定 `.tanyue.json` Agent 导入协议、CLI 和 inbox 投递。
6. 完成 Agent 导入包的独立覆盖率复核、拒绝留档和重复导入防护。
7. 完成导入预览确认。
8. Windows 焦点、托盘、休眠恢复、开机启动端到端测试。

EPUB、PDF、DOCX、URL 和 OCR 默认由外部 Agent 转换；只有真实用户需求证明这一边界不够用时，才为单一格式批准新的原生适配器 Goal。

## 7. 质量门禁

任何 PR 或交付必须：

- `npm run verify` 通过。
- 新增领域行为必须有测试。
- TypeScript 不允许 `any` 扩散到领域层。
- 任何导入失败都返回明确原因。
- 任何第三方依赖都记录许可证和固定版本策略。
- UI 不得出现阻塞用户工作的强制弹窗。
- 桌面弹窗必须验证“不主动抢走正在输入应用的焦点”。
- 数据迁移必须可回滚或至少有备份。

## 8. 发布前硬性测试

- 《道德经》81 章无漏段、无重复、顺序正确。
- 20 万字非虚构文本导入后覆盖率 100%。
- 电脑睡眠两小时后恢复，不补弹历史提醒。
- 关闭主窗口只隐藏到托盘；“退出”才结束进程。
- 关闭开机启动后系统启动项清理干净。
- 不在安装包、日志或数据库中出现模型密钥。
- 恶意 EPUB/HTML 脚本无法执行。

## 9. 品牌名处理

“弹阅”是当前确定的产品名称，但仍应集中配置，避免散落到业务逻辑中。调整品牌时至少同步：

- `src/utils.ts` → `BRAND`
- `src/index.html`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `README.md`
- 安装包标识符和图标

在正式商业发布前必须做商标、域名和应用商店重名检索。
