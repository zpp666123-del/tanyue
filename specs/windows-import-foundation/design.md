# Windows 工程门禁与正式文本导入基础：技术设计

## 1. 设计目标

本设计用一条最小纵向链路同时解决三个问题：Windows 上无法可靠执行质量门禁、文本解析与 UI 耦合、导入完整性只能凭结果猜测而不能被证明。

不改变现有页面结构，不引入前端框架或第三方解析库。

## 2. 模块边界

```text
File / JSON text
      │
      ▼
SourceAdapter registry ── detect / parse / locate / dispose
      │
      ▼
NormalizedDocument + DocumentBlock[]
      │
      ▼
segmenter ── Segment[] + CoverageReport
      │                    │
      └──────── validation ┘
               │ valid only
               ▼
            store.ts
```

- `src/source-adapter.ts`：定义统一接口、输入模型、适配器选择和明确错误类型。
- `src/text-source-adapter.ts`：只负责 TXT/Markdown 的检测、标准化、结构块与行号锚点生成。
- `src/segmenter.ts`：只负责将标准化正文块拆分、组合、生成片段与覆盖率报告。
- `src/store.ts`：只接收验证通过的 `ImportResult`，并保持展示/确认状态语义。
- `src/app.ts`：只编排文件读取、适配器选择、成功/失败提示和状态提交，不保存解析规则。
- `tools/*.mjs`：只负责跨平台路径、阶段执行与退出码传播。

## 3. 领域模型

### 3.1 标准化文档

```ts
interface DocumentBlock {
  id: string;
  sequence: number;
  type: "heading" | "paragraph" | "list";
  text: string;
  sourceAnchor: SourceAnchor;
  contentHash: string;
}

interface NormalizedDocument {
  id: string;
  title: string;
  sourceFormat: SourceFormat;
  sourceName: string;
  adapterId: string;
  parserVersion: string;
  blocks: DocumentBlock[];
}
```

标题块保留在标准化文档中用于章节语义，但覆盖率分母只统计可阅读正文块。

### 3.2 适配器

```ts
interface SourceAdapter<Input> {
  readonly id: string;
  readonly version: string;
  detect(input: Input): Promise<number>;
  parse(input: Input): Promise<NormalizedDocument>;
  locate(anchor: SourceAnchor): Promise<SourceAnchor | null>;
  dispose(): Promise<void>;
}
```

`detect` 返回 0～1 的置信度。注册表选择最高分且大于 0 的适配器；无匹配、空内容和解析异常使用带错误码的 `SourceAdapterError`。

本轮仅注册 `PlainTextSourceAdapter`，支持 `.txt`、`.md`、`.markdown`。它只处理字符串，不创建 DOM、不执行 HTML 或脚本。

### 3.3 覆盖区间

超长正文块可能跨多个片段，因此不能只用“片段是否带 blockId”判断覆盖。拆分器为每个正文块创建有序、不可变的来源区间：

```ts
interface SegmentSourceRun {
  blockId: string;
  startOffset: number;
  endOffset: number;
  sourceAnchor: SourceAnchor;
  contentHash: string;
}
```

对于每个原始正文块，所有 run 必须满足：

1. 第一段从 `0` 开始，最后一段在 `block.text.length` 结束。
2. 相邻区间首尾相接，不留空洞、不重叠。
3. run 按 block 顺序和 offset 顺序只递增。
4. 每个 run 只属于一个 Segment。
5. 按区间重建的内容与标准化 block 文本完全一致。

这使超长段可以安全拆分，同时能够证明原块内容被覆盖一次且仅一次。

### 3.4 覆盖率报告

```ts
interface CoverageReport {
  readableBlockCount: number;
  coveredBlockCount: number;
  segmentCount: number;
  coveragePercent: number;
  duplicateRunCount: number;
  gapCount: number;
  outOfOrderCount: number;
  emptySegmentCount: number;
  valid: boolean;
}
```

`ImportResult` 必须携带此报告。只有 `valid === true`、覆盖率 100%、重复/空洞/乱序/空片段均为 0 时，`addImportedContent` 才允许写入状态；否则抛出明确完整性错误。

相同文本出现在不同原文位置不等于覆盖重复。内容哈希重复会继续作为警告报告，但不冒充“同一来源区间被重复引用”。

### 3.5 追溯信息

```ts
interface ProcessingTrace {
  parserId: string;
  parserVersion: string;
  segmenterVersion: string;
  ruleVersion: string;
  aiPromptVersion: string | null;
  aiModel: string | null;
  createdAt: string;
}
```

每个新 Segment 都保存 `sourceRuns` 和 `processingTrace`。本轮没有 AI 调用，所以两个 AI 字段固定为 `null`。演示数据和旧 LocalStorage 数据用明确的 `legacy-unversioned` 回填，而不是伪造具体版本。

## 4. 拆分策略

1. 按 `DocumentBlock.sequence` 遍历。
2. 标题只更新当前章节，不进入正文覆盖率分母。
3. 普通正文块优先保持完整。
4. 超长正文块按句末标点寻找边界；没有句末标点时按目标字符数并尽量靠近标点切分。
5. 每个切分单元保留原 block 的精确字符 offset，不通过二次 trim 丢失区间内容。
6. 将相邻单元组合到目标片段长度；组合不得改变单元顺序。
7. 生成片段后独立运行覆盖校验器，校验通过才构造成功的 `ImportResult`。

`originalText` 只由对应 run 的原文切片组合生成；`helperTitle` 和 `contextBridge` 继续作为辅助字段，不进入覆盖校验。

## 5. 兼容策略

- 保留 `parsePlainText` 和 `importTextDocument` 作为薄兼容入口，但内部必须调用正式适配器/标准化逻辑，避免现有调用方一次性大改。
- 领域新增字段设为类型必需字段；`loadState` 对旧状态执行确定性回填。
- 本轮不提升 SQLite schema，因为 SQLite 尚未接入；LocalStorage 的 `schemaVersion` 是否提升由实现测试决定，但不得静默丢失书籍、进度、收藏或笔记。
- 演示数据补齐合法覆盖报告所需的片段追溯信息，不改变《道德经》正文。

## 6. Windows 工程门禁

- 使用 Node.js `fileURLToPath(import.meta.url)` 和 `dirname` 计算脚本路径，禁止直接把 URL pathname 当 Windows 路径。
- `verify.mjs` 逐阶段输出 `typecheck`、`test`、`build`、`artifacts`，原样传播失败退出码。
- 测试临时目录继续限定为项目下 `.build`；构建目录继续限定为项目下 `dist`。
- 生成并提交 `package-lock.json`，使用 lockfile 固定完整依赖树。
- 不在本轮伪造 Cargo 验证结果；没有 Rust 时，`PROJECT_STATUS.md` 明确记录未执行。

## 7. 测试设计

将当前单文件断言升级为具名测试用例，但不额外引入测试框架：

- `tests/test-harness.ts`：收集用例、逐项报告、失败后返回非零退出码。
- `tests/source-adapter.test.ts`：格式检测、空输入、Markdown 标题、行号锚点、安全纯文本行为。
- `tests/segmenter.test.ts`：多块组合、超长段区间、完整重建、100% 覆盖、无重复区间、顺序与追溯字段。
- `tests/store.test.ts`：无效报告不得写入、`shown`/`confirmed` 分离。
- `tests/demo-data.test.ts`：《道德经》81 章连续、非空、无重复。

测试运行时不需要浏览器 DOM；涉及 LocalStorage 的加载逻辑使用最小内存桩或只测试纯状态函数。

## 8. 安全与失败处理

- 文件名只用于格式检测和来源显示，不拼接为可执行路径。
- 输入内容始终作为文本处理；错误信息不得回显整篇原文。
- 空文件、不支持格式、覆盖校验失败分别使用不同错误码。
- UI 捕获领域错误后展示文件名和简洁原因；失败内容不加入书架。

## 9. 验证命令

```bash
npm install
npm run verify
```

若本机之后具备 Rust：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:dev
```

后三项不属于本轮成功的必要条件，但实际执行结果必须如实记录。
