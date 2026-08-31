namespace TanYue {
  export const SEGMENTER_VERSION = "2.0.0";
  export const SEGMENT_RULE_VERSION = "text-rules-2.0.0";

  interface SourceUnit {
    block: DocumentBlock;
    startOffset: number;
    endOffset: number;
    chapterTitle: string;
  }

  interface SegmentGroup {
    chapterTitle: string;
    units: SourceUnit[];
  }

  function chooseSplitEnd(text: string, cursor: number, targetChars: number): number {
    if (text.length - cursor <= targetChars * 1.35) return text.length;

    const desired = Math.min(text.length, cursor + targetChars);
    const minimum = Math.min(text.length, cursor + Math.max(1, Math.floor(targetChars * 0.65)));
    const maximum = Math.min(text.length, desired + 60);
    const punctuation = /[，、,。！？!?；;]/;

    for (let end = desired; end <= maximum; end += 1) {
      if (punctuation.test(text.charAt(end - 1))) return end;
    }
    for (let end = desired; end >= minimum; end -= 1) {
      if (punctuation.test(text.charAt(end - 1))) return end;
    }
    return Math.max(cursor + 1, desired);
  }

  function splitBlock(block: DocumentBlock, targetChars: number, chapterTitle: string): SourceUnit[] {
    if (countReadableChars(block.text) <= targetChars * 1.35) {
      return [{ block, startOffset: 0, endOffset: block.text.length, chapterTitle }];
    }

    const units: SourceUnit[] = [];
    let cursor = 0;
    while (cursor < block.text.length) {
      const endOffset = chooseSplitEnd(block.text, cursor, targetChars);
      units.push({ block, startOffset: cursor, endOffset, chapterTitle });
      cursor = endOffset;
    }
    return units;
  }

  function renderUnits(units: SourceUnit[]): string {
    let text = "";
    let previous: SourceUnit | null = null;
    units.forEach((unit) => {
      const slice = unit.block.text.slice(unit.startOffset, unit.endOffset);
      const sameBlockContinuation = previous?.block.id === unit.block.id && previous.endOffset === unit.startOffset;
      text += text && !sameBlockContinuation ? `\n\n${slice}` : slice;
      previous = unit;
    });
    return text;
  }

  function collectSourceUnits(document: NormalizedDocument, targetChars: number): SourceUnit[] {
    const units: SourceUnit[] = [];
    let chapterTitle = document.title;

    document.blocks
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .forEach((block) => {
        if (block.type === "heading") {
          chapterTitle = block.text;
          return;
        }
        if (block.text.length > 0) units.push(...splitBlock(block, targetChars, chapterTitle));
      });
    return units;
  }

  function groupSourceUnits(units: SourceUnit[], targetChars: number): SegmentGroup[] {
    const maxChars = Math.round(targetChars * 1.38);
    const groups: SegmentGroup[] = [];
    let current: SourceUnit[] = [];
    let chapterTitle = units[0]?.chapterTitle || "未命名章节";

    const flush = (): void => {
      if (current.length) groups.push({ chapterTitle, units: current });
      current = [];
    };

    units.forEach((unit) => {
      if (current.length && unit.chapterTitle !== chapterTitle) {
        flush();
        chapterTitle = unit.chapterTitle;
      }

      const candidate = [...current, unit];
      if (current.length && countReadableChars(renderUnits(candidate)) > maxChars) {
        flush();
        chapterTitle = unit.chapterTitle;
      }

      current.push(unit);
      if (countReadableChars(renderUnits(current)) >= targetChars) flush();
    });
    flush();
    return groups;
  }

  function sourceRunForUnit(unit: SourceUnit): SegmentSourceRun {
    const text = unit.block.text.slice(unit.startOffset, unit.endOffset);
    return {
      blockId: unit.block.id,
      startOffset: unit.startOffset,
      endOffset: unit.endOffset,
      sourceAnchor: unit.block.sourceAnchor,
      contentHash: hashText(text)
    };
  }

  export function createCoverageReport(document: NormalizedDocument, segments: Segment[]): CoverageReport {
    const readableBlocks = document.blocks
      .filter((block) => block.type !== "heading" && block.text.length > 0)
      .sort((left, right) => left.sequence - right.sequence);
    const blockById = new Map(readableBlocks.map((block) => [block.id, block]));
    const blockOrder = new Map(readableBlocks.map((block, index) => [block.id, index]));
    const orderedRuns = segments
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .flatMap((segment) => segment.sourceRuns);

    let outOfOrderCount = 0;
    let previousOrder = -1;
    let previousOffset = -1;
    orderedRuns.forEach((run) => {
      const order = blockOrder.get(run.blockId);
      if (order === undefined || order < previousOrder || order === previousOrder && run.startOffset < previousOffset) {
        outOfOrderCount += 1;
      }
      previousOrder = order ?? previousOrder;
      previousOffset = run.endOffset;
    });

    let duplicateRunCount = 0;
    let gapCount = 0;
    let coveredBlockCount = 0;

    readableBlocks.forEach((block) => {
      const runs = orderedRuns.filter((run) => run.blockId === block.id);
      let cursor = 0;
      let blockValid = runs.length > 0;

      runs.forEach((run) => {
        if (run.startOffset > cursor) {
          gapCount += 1;
          blockValid = false;
        }
        if (run.startOffset < cursor) {
          duplicateRunCount += 1;
          blockValid = false;
        }
        if (run.endOffset <= run.startOffset || run.endOffset > block.text.length) {
          gapCount += 1;
          blockValid = false;
        } else if (hashText(block.text.slice(run.startOffset, run.endOffset)) !== run.contentHash) {
          gapCount += 1;
          blockValid = false;
        }
        cursor = Math.max(cursor, run.endOffset);
      });

      if (cursor < block.text.length) {
        gapCount += 1;
        blockValid = false;
      }
      if (blockValid && cursor === block.text.length) coveredBlockCount += 1;
    });

    orderedRuns.forEach((run) => {
      if (!blockById.has(run.blockId)) gapCount += 1;
    });

    const emptySegmentCount = segments.filter((segment) => !segment.originalText.trim() || segment.sourceRuns.length === 0).length;
    const coveragePercent = readableBlocks.length
      ? Math.round((coveredBlockCount / readableBlocks.length) * 100)
      : 0;
    const valid = readableBlocks.length > 0
      && coveragePercent === 100
      && duplicateRunCount === 0
      && gapCount === 0
      && outOfOrderCount === 0
      && emptySegmentCount === 0;

    return {
      readableBlockCount: readableBlocks.length,
      coveredBlockCount,
      segmentCount: segments.length,
      coveragePercent,
      duplicateRunCount,
      gapCount,
      outOfOrderCount,
      emptySegmentCount,
      valid
    };
  }

  export function segmentDocument(
    document: NormalizedDocument,
    targetSeconds: 30 | 60 | 90,
    options?: { bookId?: string; author?: string; sourceName?: string; sourceUrl?: string }
  ): ImportResult {
    const targetChars = Math.round(targetSeconds * 5.2);
    const bookId = options?.bookId || uid("book");
    const sourceUnits = collectSourceUnits(document, targetChars);
    if (!sourceUnits.length) throw new SourceAdapterError("empty_source", "没有识别到可阅读正文。");

    const groups = groupSourceUnits(sourceUnits, targetChars);
    const createdAt = new Date().toISOString();
    const headingCounts = new Map<string, number>();
    const headingTotals = new Map<string, number>();
    groups.forEach((group) => headingTotals.set(group.chapterTitle, (headingTotals.get(group.chapterTitle) || 0) + 1));

    const segments: Segment[] = groups.map((group, index) => {
      const count = (headingCounts.get(group.chapterTitle) || 0) + 1;
      headingCounts.set(group.chapterTitle, count);
      const suffix = (headingTotals.get(group.chapterTitle) || 0) > 1 ? ` · ${count}` : "";
      const originalText = renderUnits(group.units);
      const sourceRuns = group.units.map(sourceRunForUnit);
      return {
        id: `${bookId}_seg_${String(index + 1).padStart(4, "0")}`,
        bookId,
        sequence: index + 1,
        chapterTitle: `${group.chapterTitle}${suffix}`,
        helperTitle: firstSentence(originalText, 30).replace(/[。！？!?]$/, ""),
        originalText,
        contextBridge: index === 0 ? "从这里开始阅读。" : "接着上一段，继续读下去。",
        estimatedSeconds: estimateReadingSeconds(originalText),
        sourceAnchor: sourceRuns[0].sourceAnchor,
        contentHash: hashText(originalText),
        sourceRuns,
        processingTrace: {
          parserId: document.adapterId,
          parserVersion: document.parserVersion,
          segmenterVersion: SEGMENTER_VERSION,
          ruleVersion: SEGMENT_RULE_VERSION,
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

    const coverage = createCoverageReport(document, segments);
    if (!coverage.valid) {
      throw new Error(
        `导入完整性检查失败：覆盖率 ${coverage.coveragePercent}%，空洞 ${coverage.gapCount}，重复 ${coverage.duplicateRunCount}，乱序 ${coverage.outOfOrderCount}。`
      );
    }

    const warnings: string[] = [];
    const contentHashes = new Map<string, DocumentBlock>();
    document.blocks.filter((block) => block.type !== "heading").forEach((block) => {
      const previous = contentHashes.get(block.contentHash);
      if (previous) warnings.push(`检测到疑似重复内容：${previous.sourceAnchor.label} 与 ${block.sourceAnchor.label}`);
      else contentHashes.set(block.contentHash, block);
    });

    const totalChars = segments.reduce((sum, segment) => sum + countReadableChars(segment.originalText), 0);
    const sourceName = options?.sourceName || document.sourceName;
    const book: Book = {
      id: bookId,
      title: document.title,
      author: options?.author || "未知作者",
      kind: document.sourceFormat === "url" ? "article" : "document",
      format: document.sourceFormat,
      sourceName,
      sourceUrl: options?.sourceUrl,
      description: `自动解析为 ${segments.length} 个微阅读片段，正文覆盖率 ${coverage.coveragePercent}%。`,
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

  export async function importTextDocument(
    filename: string,
    text: string,
    targetSeconds: 30 | 60 | 90
  ): Promise<ImportResult> {
    const document = await parseTextSource({ name: filename, text });
    return segmentDocument(document, targetSeconds, { sourceName: filename });
  }

}
