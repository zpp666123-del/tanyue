namespace TanYue {
  export const IMPORT_PACKAGE_SCHEMA_VERSION = 1;
  export const IMPORT_PACKAGE_OFFSET_UNIT = "unicode-scalar";
  const MAX_PACKAGE_CHARS = 25_000_000;
  const MAX_BLOCKS = 100_000;
  const MAX_SEGMENTS = 100_000;

  export class ImportPackageError extends Error {
    constructor(public readonly code: ImportPackageErrorCode, message: string) {
      super(message);
      this.name = "ImportPackageError";
    }
  }

  function invalid(message: string): never {
    throw new ImportPackageError("invalid_package", message);
  }

  function record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} 必须是对象。`);
    return value as Record<string, unknown>;
  }

  function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) invalid(`${path} 必须是数组。`);
    return value;
  }

  function text(value: unknown, path: string, maximum = 500): string {
    if (typeof value !== "string" || !value.trim()) invalid(`${path} 必须是非空字符串。`);
    const result = value.trim();
    if (result.length > maximum) invalid(`${path} 超过 ${maximum} 个字符。`);
    return result;
  }

  function integer(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${path} 必须是非负整数。`);
    return value;
  }

  function optionalText(value: unknown, path: string, maximum = 500): string | undefined {
    return value === undefined || value === null || value === "" ? undefined : text(value, path, maximum);
  }

  function originalBlockText(value: unknown, path: string): string {
    if (typeof value !== "string" || !value.trim()) invalid(`${path} 必须包含正文。`);
    if (value.length > MAX_PACKAGE_CHARS) invalid(`${path} 超过大小限制。`);
    return value;
  }

  const sourceFormats: SourceFormat[] = ["txt", "md", "url", "pdf", "docx", "epub", "json"];
  const blockTypes: DocumentBlock["type"][] = ["heading", "paragraph", "list"];
  const anchorKinds: SourceAnchor["kind"][] = ["chapter", "line", "page", "cfi", "url"];

  function enumValue<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${path} 的值不受支持。`);
    return value as T;
  }

  function sourceAnchor(value: unknown, path: string): SourceAnchor {
    const item = record(value, path);
    return {
      kind: enumValue(item.kind, `${path}.kind`, anchorKinds),
      value: text(item.value, `${path}.value`, 1000),
      label: text(item.label, `${path}.label`, 1000)
    };
  }

  function utf16Offsets(value: string): number[] {
    const offsets = [0];
    let offset = 0;
    for (const scalar of value) {
      offset += scalar.length;
      offsets.push(offset);
    }
    return offsets;
  }

  export function looksLikeAgentImportPackage(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    return item.schemaVersion !== undefined && Array.isArray(item.blocks) && Array.isArray(item.segments);
  }

  export function importAgentPackage(raw: string): ImportResult {
    if (raw.length > MAX_PACKAGE_CHARS) {
      throw new ImportPackageError("package_too_large", "导入包超过 2500 万字符限制。");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ImportPackageError("invalid_json", "导入包不是有效 JSON。");
    }

    const root = record(parsed, "导入包");
    if (root.schemaVersion !== IMPORT_PACKAGE_SCHEMA_VERSION) {
      throw new ImportPackageError("unsupported_schema", `不支持的导入包版本：${String(root.schemaVersion)}。`);
    }
    if (root.offsetUnit !== IMPORT_PACKAGE_OFFSET_UNIT) {
      invalid(`offsetUnit 必须是 ${IMPORT_PACKAGE_OFFSET_UNIT}。`);
    }

    const bookInput = record(root.book, "book");
    const title = text(bookInput.title, "book.title", 300);
    const author = optionalText(bookInput.author, "book.author", 300) || "未知作者";
    const sourceInput = record(root.source, "source");
    const sourceName = text(sourceInput.name, "source.name", 1000);
    const sourceFormat = enumValue(sourceInput.format, "source.format", sourceFormats);
    const sourceMediaType = optionalText(sourceInput.mediaType, "source.mediaType", 200);
    const sourceHash = optionalText(sourceInput.sha256, "source.sha256", 64)?.toLowerCase();
    if (sourceHash && !/^[a-f0-9]{64}$/.test(sourceHash)) invalid("source.sha256 必须是 64 位十六进制 SHA-256。");

    const processing = record(root.processing, "processing");
    const parser = record(processing.parser, "processing.parser");
    const segmenter = record(processing.segmenter, "processing.segmenter");
    const parserId = text(parser.id, "processing.parser.id", 200);
    const parserVersion = text(parser.version, "processing.parser.version", 100);
    const segmenterId = text(segmenter.id, "processing.segmenter.id", 200);
    const segmenterVersion = text(segmenter.version, "processing.segmenter.version", 100);
    const ruleVersion = text(segmenter.ruleVersion, "processing.segmenter.ruleVersion", 100);

    const blockInput = array(root.blocks, "blocks");
    if (!blockInput.length || blockInput.length > MAX_BLOCKS) invalid(`blocks 数量必须在 1 到 ${MAX_BLOCKS} 之间。`);
    const blockIds = new Set<string>();
    const offsetMaps = new Map<string, number[]>();
    let totalScalars = 0;
    const identityParts: string[] = [];
    const documentId = `document_agent_${hashText(`${sourceName}\u0000${sourceHash || title}`).slice(6)}`;
    const blocks: DocumentBlock[] = blockInput.map((value, index) => {
      const item = record(value, `blocks[${index}]`);
      const id = text(item.id, `blocks[${index}].id`, 200);
      if (blockIds.has(id)) invalid(`blocks[${index}].id 重复：${id}。`);
      blockIds.add(id);
      const sequence = integer(item.sequence, `blocks[${index}].sequence`);
      if (sequence !== index + 1) invalid(`blocks[${index}].sequence 必须连续并从 1 开始。`);
      const type = enumValue(item.type, `blocks[${index}].type`, blockTypes);
      const blockText = originalBlockText(item.text, `blocks[${index}].text`);
      const offsets = utf16Offsets(blockText);
      totalScalars += offsets.length - 1;
      if (totalScalars > MAX_PACKAGE_CHARS) invalid("正文超过 2500 万 Unicode 字符限制。");
      offsetMaps.set(id, offsets);
      identityParts.push(id, type, blockText);
      const anchor = sourceAnchor(item.sourceAnchor, `blocks[${index}].sourceAnchor`);
      return {
        id,
        sequence,
        type,
        text: blockText,
        lineStart: sequence,
        lineEnd: sequence,
        sourceAnchor: anchor,
        contentHash: hashText(blockText)
      };
    });
    const readableBlocks = blocks.filter((block) => block.type !== "heading");
    if (!readableBlocks.length) invalid("导入包没有可阅读正文块。");
    const blockById = new Map(blocks.map((block) => [block.id, block]));

    const segmentInput = array(root.segments, "segments");
    if (!segmentInput.length || segmentInput.length > MAX_SEGMENTS) invalid(`segments 数量必须在 1 到 ${MAX_SEGMENTS} 之间。`);
    const bookId = `book_agent_${hashText(identityParts.join("\u0000")).slice(6)}`;
    const createdAt = new Date().toISOString();
    const segments: Segment[] = segmentInput.map((value, index) => {
      const item = record(value, `segments[${index}]`);
      const sequence = integer(item.sequence, `segments[${index}].sequence`);
      if (sequence !== index + 1) invalid(`segments[${index}].sequence 必须连续并从 1 开始。`);
      const spans = array(item.spans, `segments[${index}].spans`);
      if (!spans.length) invalid(`segments[${index}].spans 不能为空。`);
      let originalText = "";
      let previousRun: SegmentSourceRun | null = null;
      const sourceRuns = spans.map((spanValue, spanIndex): SegmentSourceRun => {
        const span = record(spanValue, `segments[${index}].spans[${spanIndex}]`);
        const blockId = text(span.blockId, `segments[${index}].spans[${spanIndex}].blockId`, 200);
        const block = blockById.get(blockId);
        if (!block || block.type === "heading") invalid(`segments[${index}].spans[${spanIndex}] 引用了不存在或不可阅读的块。`);
        const start = integer(span.start, `segments[${index}].spans[${spanIndex}].start`);
        const end = integer(span.end, `segments[${index}].spans[${spanIndex}].end`);
        const offsets = offsetMaps.get(blockId)!;
        if (end <= start || end >= offsets.length) invalid(`segments[${index}].spans[${spanIndex}] 的字符范围无效。`);
        const startOffset = offsets[start];
        const endOffset = offsets[end];
        const slice = block.text.slice(startOffset, endOffset);
        const sameBlockContinuation = previousRun?.blockId === blockId && previousRun.endOffset === startOffset;
        originalText += originalText && !sameBlockContinuation ? `\n\n${slice}` : slice;
        const run: SegmentSourceRun = {
          blockId,
          startOffset,
          endOffset,
          sourceAnchor: block.sourceAnchor,
          contentHash: hashText(slice)
        };
        previousRun = run;
        return run;
      });
      const chapterTitle = optionalText(item.chapterTitle, `segments[${index}].chapterTitle`, 300) || sourceRuns[0].sourceAnchor.label;
      return {
        id: `${bookId}_seg_${String(sequence).padStart(4, "0")}`,
        bookId,
        sequence,
        chapterTitle,
        helperTitle: firstSentence(originalText, 30).replace(/[。！？!?]$/, ""),
        originalText,
        contextBridge: index === 0 ? "从这里开始阅读。" : "接着上一段，继续读下去。",
        estimatedSeconds: estimateReadingSeconds(originalText),
        sourceAnchor: sourceRuns[0].sourceAnchor,
        contentHash: hashText(originalText),
        sourceRuns,
        processingTrace: {
          parserId,
          parserVersion,
          segmenterVersion: `${segmenterId}@${segmenterVersion}`,
          ruleVersion,
          aiPromptVersion: null,
          aiModel: null,
          createdAt
        },
        status: "unread",
        favorite: false,
        note: "",
        viewCount: 0
      };
    });

    const document: NormalizedDocument = {
      id: documentId,
      title,
      blocks,
      sourceFormat,
      sourceName,
      adapterId: parserId,
      parserVersion
    };
    const coverage = createCoverageReport(document, segments);
    if (!coverage.valid) {
      throw new ImportPackageError(
        "invalid_coverage",
        `导入包覆盖失败：覆盖率 ${coverage.coveragePercent}%，空洞 ${coverage.gapCount}，重复 ${coverage.duplicateRunCount}，乱序 ${coverage.outOfOrderCount}。`
      );
    }

    const warnings: string[] = [];
    const contentHashes = new Map<string, DocumentBlock>();
    readableBlocks.forEach((block) => {
      const previous = contentHashes.get(block.contentHash);
      if (previous) warnings.push(`检测到疑似重复内容：${previous.sourceAnchor.label} 与 ${block.sourceAnchor.label}`);
      else contentHashes.set(block.contentHash, block);
    });
    const totalChars = segments.reduce((sum, segment) => sum + countReadableChars(segment.originalText), 0);
    const book: Book = {
      id: bookId,
      title,
      author,
      kind: sourceFormat === "url" ? "article" : "document",
      format: sourceFormat,
      sourceName,
      sourceHash,
      sourceMediaType,
      description: `由外部 Agent 解析为 ${segments.length} 个微阅读片段，弹阅复核覆盖率 ${coverage.coveragePercent}%。`,
      accent: "#6f725c",
      coverStyle: "paper",
      segmentCount: segments.length,
      totalChars,
      currentSequence: 1,
      createdAt,
      updatedAt: createdAt,
      lastOpenedAt: createdAt,
      archived: false
    };
    return { book, segments, coverage, warnings };
  }
}
