# 第三方依赖与许可记录

本文件用于记录当前工程已声明依赖，以及后续计划接入的开源组件。发布前必须根据锁文件和实际打包内容重新生成完整清单，不能仅依赖本说明。

## 当前工程声明依赖

| 组件 | 用途 | 许可策略 |
|---|---|---|
| Tauri v2 | 桌面壳、窗口、托盘与打包 | MIT / Apache-2.0，保留版权与许可文本 |
| Tauri Autostart Plugin | 开机启动 | MIT / Apache-2.0，保留版权与许可文本 |
| Tauri Notification Plugin | 系统通知 | MIT / Apache-2.0，保留版权与许可文本 |
| Tauri Opener Plugin | 使用系统应用打开外部资源 | MIT / Apache-2.0，保留版权与许可文本 |
| rusqlite | Rust 侧 SQLite 参数化查询、事务与数据仓储 | MIT；由 `Cargo.lock` 固定实际版本 |
| SQLite（bundled） | 本地嵌入式数据库引擎 | Public Domain；由 rusqlite/libsqlite3-sys 随包构建 |
| RustCrypto SHA-2 | LocalStorage 迁移备份 SHA-256 校验 | MIT / Apache-2.0；由 `Cargo.lock` 固定实际版本 |
| TypeScript | 编译与类型检查 | Apache-2.0，开发依赖 |

前端业务代码当前没有运行时 UI 框架依赖。

## 计划通过适配器接入

| 组件 | 计划用途 | 许可与处理原则 |
|---|---|---|
| foliate-js | EPUB/MOBI/AZW3/FB2 等电子书解析与定位 | MIT；固定版本或 commit，隔离在适配器层 |
| PDF.js | 文字型 PDF 解析、渲染和页码定位 | Apache-2.0；隔离在适配器层 |
| Mammoth.js | DOCX 转换为结构化 HTML | BSD-2-Clause；隔离在适配器层 |
| Mozilla Readability | 网页正文提取 | Apache-2.0；与受限 HTTP 客户端配合 |

## 默认禁止直接复制的项目

Readest、Koodo Reader、Calibre 等完整项目可用于产品研究和架构参考，但 AGPL/GPL 代码不得未经许可分析和法务审查直接复制进拟闭源发行版。

## 发布门禁

发布候选版本必须完成：

1. 从 lockfile 和二进制产物生成实际依赖清单。
2. 将所有要求随发行版提供的许可证和版权文本打包。
3. 记录组件版本、来源、修改情况和用途。
4. 对 GPL、AGPL、字体、图标、示例内容和模型服务条款单独复核。
5. 不得仅凭 GitHub 仓库首页的许可证标签作最终法律判断。
