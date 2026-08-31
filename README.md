# 弹阅

> 少而精地读，深而静地思。

[![Version](https://img.shields.io/badge/version-0.2.3-c46b48)](https://github.com/zpp666123-del/tanyue/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-4b687c)](https://github.com/zpp666123-del/tanyue/releases/latest)
[![Verify](https://github.com/zpp666123-del/tanyue/actions/workflows/verify.yml/badge.svg)](https://github.com/zpp666123-del/tanyue/actions/workflows/verify.yml)
[![Tauri](https://img.shields.io/badge/Tauri-v2-6d7d6d)](https://v2.tauri.app/)
[![License](https://img.shields.io/badge/license-MIT-2f2f2f)](LICENSE)

弹阅是一款面向上班族的 Windows 桌面微阅读工具。它把书籍、文档或网页整理成几十秒可以读完的完整片段，在工作间隙通过轻量弹窗呈现，并准确接续每本书的阅读位置。

数据默认保存在本机；应用不内置 API Key，不自动上传原文，也不执行电子书或网页中的脚本。

![弹阅主界面](docs/screenshots-v0.2/tanyue-main.png)

## 下载

前往 [GitHub Releases](https://github.com/zpp666123-del/tanyue/releases/latest) 下载：

```text
弹阅_0.2.3_x64-setup.exe
```

双击安装即可。当前版本是未签名测试版，Windows 可能显示“未知发布者”；请从本仓库 Releases 下载，并可使用同目录的 `.sha256` 文件核对完整性。

系统要求：Windows 10/11 x64、Microsoft Edge WebView2 Runtime。

## 核心体验

- **几十秒读一段**：正文按语义边界拆成可在短暂间隙完成的片段。
- **安静出现**：弹窗不强制全屏，支持关闭、稍后提醒、今天暂停和展开阅读。
- **准确接续**：每本书独立保存阅读位置，切换书籍时明确提示将从哪里继续。
- **自适应阅读**：弹窗尺寸和停留时间跟随正文长度，可限制为紧凑或小窗模式。
- **本地优先**：书籍、片段、收藏、笔记、计划和阅读事件保存在本地 SQLite。
- **完整可追溯**：每个片段保留书籍、顺序、来源锚点、内容哈希和处理版本。
- **Agent 导入**：复杂格式由用户选择的 Agent 解析，弹阅负责严格校验、入库和阅读。

## 已内置内容

首次启动会加入以下内容，均从未读状态开始，不包含开发者的阅读记录：

- 《道德经》81 章
- 《毛泽东选集》第一至第五卷正文版
- 《毛主席语录》正文版

内置内容经过顺序、重复和覆盖率检查；软件代码采用 MIT License，内置文本及其整理数据的权利仍归相应权利人。

## 界面

| 微读弹窗 | 连续阅读 |
| --- | --- |
| ![微读弹窗](docs/screenshots-v0.2/tanyue-popup.png) | ![连续阅读](docs/screenshots-v0.2/tanyue-reader.png) |

### 桌面悬浮入口

![桌面悬浮入口](docs/screenshots-v0.2/tanyue-floating.png)

## 支持的导入方式

弹阅原生支持：

- TXT
- Markdown
- `.tanyue.json` 标准导入包

PDF、EPUB、DOCX、URL 和 OCR 等来源可以先由任意 Agent 转换为标准导入包。弹阅会从原文块重新构造正文，验证顺序、范围、哈希与 100% 覆盖率，校验不通过的内容不会进入书架。

### Agent / CLI 导入

安装包同时提供 `tanyue-cli.exe`：

```powershell
tanyue-cli schema
tanyue-cli validate "D:\Books\book.tanyue.json"
tanyue-cli import "D:\Books\book.tanyue.json"
```

- `schema`：输出当前导入协议的 JSON Schema。
- `validate`：离线校验结构、字符范围、连续序号和覆盖关系。
- `import`：将通过初检的文件原子投递给正在运行的弹阅。

协议位于 [`public/tanyue-import.schema.json`](public/tanyue-import.schema.json)，最小示例位于 [`public/examples/agent-import-example.tanyue.json`](public/examples/agent-import-example.tanyue.json)。字符范围统一使用 Unicode scalar offset，避免中文和 emoji 的跨语言偏移差异。

## 本地开发

### 环境

- Node.js 20+
- Rust stable（Tauri 桌面版）
- Visual Studio Build Tools / MSVC（Windows 打包）
- WebView2 Runtime

### 安装与运行

```bash
npm install
npm run tauri:dev
```

只预览前端：

```bash
npm run build
npm run preview
```

### 验证

```bash
npm run verify
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

`npm run verify` 会执行 TypeScript 严格检查、48 项领域测试、静态构建和关键产物检查。

### 构建 Windows 安装包

```bash
npm run release:windows
```

产物位于 `release/`，包含 NSIS x64 安装包和 SHA-256 校验文件。代码签名证书可通过 `TANYUE_SIGN_CERT_SHA1` 和 `TANYUE_SIGN_TIMESTAMP_URL` 接入现有发布脚本。

## 工程结构

```text
src/                         前端、领域逻辑与窗口编排
├─ source-adapter.ts         统一来源适配器
├─ text-source-adapter.ts    TXT / Markdown 解析
├─ import-package.ts         Agent 导入包复核
├─ segmenter.ts              规则拆分与覆盖率验证
├─ scheduler.ts              提醒时间计算
├─ store.ts                  状态与阅读进度
├─ persistence.ts            SQLite / LocalStorage 仓储
├─ views.ts                  主界面与连续阅读
├─ popup.ts                  微读弹窗生命周期
└─ floating.ts               悬浮入口与位置

src-tauri/                   Tauri v2 桌面壳、SQLite 与 CLI
public/                      图标、内置内容和导入协议
tests/                       TypeScript 领域测试
tools/                       构建、校验和发布脚本
docs/                        产品、架构与交互文档
```

## 设计原则

1. 原文不可被 AI 替换，AI 结果只能作为明确分层的辅助信息。
2. 每个正文块必须被且只被一个片段覆盖，禁止静默丢段、重复或乱序。
3. 自动展示不等于确认读完，阅读状态必须可解释。
4. 用户始终可以轻松关闭、延后或暂停提醒。
5. 默认本地保存和最小权限，不把弹阅扩张成重型书库或知识库。

更完整的工程边界见 [`AGENTS.md`](AGENTS.md) 和 [`docs/`](docs/)。

## 参与开发

欢迎提交 Issue 和 Pull Request。提交前请运行：

```bash
npm run verify
```

涉及桌面壳、持久化或安装流程的修改，还需要通过 Rust 检查和 Windows 真机验证。

## License

软件代码采用 [MIT License](LICENSE)。第三方依赖与许可记录见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
