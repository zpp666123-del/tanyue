namespace TanYue {
  export const TEXT_ADAPTER_ID = "tanyue.plain-text";
  export const TEXT_ADAPTER_VERSION = "1.0.0";

  const CHINESE_NUMBER = "一二三四五六七八九十百千〇零两0-9";
  const HEADING_PATTERNS = [
    new RegExp(`^第[${CHINESE_NUMBER}]+[章节篇回卷部]([：:].*)?$`),
    /^#{1,6}\s+\S+/,
    /^(序|前言|引言|绪论|结语|后记|附录)([：:].*)?$/,
    /^[一二三四五六七八九十]+[、.．]\s*\S+/
  ];

  export function normalizeImportedText(text: string): string {
    return text
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u00a0\u3000]/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  export function isLikelyHeading(line: string, previousBlank = false, nextBlank = false): boolean {
    const value = line.trim();
    if (!value || value.length > 60) return false;
    if (HEADING_PATTERNS.some((pattern) => pattern.test(value))) return true;
    const terminalPunctuation = /[。！？!?；;：:]$/.test(value);
    return value.length <= 22 && previousBlank && nextBlank && !terminalPunctuation;
  }

  function sourceFormatForName(name: string): "txt" | "md" | null {
    const extension = name.split(".").pop()?.toLowerCase();
    if (extension === "md" || extension === "markdown") return "md";
    if (extension === "txt") return "txt";
    return null;
  }

  function titleForName(name: string): string {
    return name.replace(/\.(txt|md|markdown)$/i, "").trim() || "未命名文档";
  }

  function createBlock(
    documentId: string,
    sequence: number,
    type: DocumentBlock["type"],
    text: string,
    lineStart: number,
    lineEnd: number
  ): DocumentBlock {
    return {
      id: `${documentId}_block_${String(sequence).padStart(5, "0")}`,
      sequence,
      type,
      text,
      lineStart,
      lineEnd,
      sourceAnchor: {
        kind: "line",
        value: `${lineStart}-${lineEnd}`,
        label: lineStart === lineEnd ? `第 ${lineStart} 行` : `第 ${lineStart}—${lineEnd} 行`
      },
      contentHash: hashText(text)
    };
  }

  export function normalizeTextDocument(
    title: string,
    rawText: string,
    sourceFormat: SourceFormat,
    sourceName: string,
    adapterId = TEXT_ADAPTER_ID,
    parserVersion = TEXT_ADAPTER_VERSION
  ): NormalizedDocument {
    const text = normalizeImportedText(rawText);
    if (!text) throw new SourceAdapterError("empty_source", "文件没有可阅读正文。");

    const documentId = `document_${hashText(`${sourceName}\u0000${text}`).replace("fnv1a_", "")}`;
    const lines = text.split("\n");
    const blocks: DocumentBlock[] = [];
    let paragraphBuffer: string[] = [];
    let paragraphStart = 1;

    const flushParagraph = (endLine: number): void => {
      const joined = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
      if (joined) {
        blocks.push(createBlock(
          documentId,
          blocks.length + 1,
          /^[-*•]\s+/.test(joined) ? "list" : "paragraph",
          joined,
          paragraphStart,
          endLine
        ));
      }
      paragraphBuffer = [];
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const previousBlank = index === 0 || !lines[index - 1].trim();
      const nextBlank = index === lines.length - 1 || !lines[index + 1].trim();

      if (!trimmed) {
        flushParagraph(index);
        return;
      }

      if (isLikelyHeading(trimmed, previousBlank, nextBlank)) {
        flushParagraph(index);
        const heading = trimmed.replace(/^#{1,6}\s+/, "");
        blocks.push(createBlock(documentId, blocks.length + 1, "heading", heading, index + 1, index + 1));
        paragraphStart = index + 2;
        return;
      }

      if (paragraphBuffer.length === 0) paragraphStart = index + 1;
      paragraphBuffer.push(trimmed);
    });
    flushParagraph(lines.length);

    if (!blocks.some((block) => block.type !== "heading" && block.text.length > 0)) {
      throw new SourceAdapterError("empty_source", "文件没有可阅读正文。");
    }

    return {
      id: documentId,
      title: title.trim() || "未命名文档",
      blocks,
      sourceFormat,
      sourceName,
      adapterId,
      parserVersion
    };
  }

  export class PlainTextSourceAdapter implements SourceAdapter<TextSourceInput> {
    readonly id = TEXT_ADAPTER_ID;
    readonly version = TEXT_ADAPTER_VERSION;

    async detect(input: TextSourceInput): Promise<number> {
      return sourceFormatForName(input.name) ? 1 : 0;
    }

    async parse(input: TextSourceInput): Promise<NormalizedDocument> {
      const format = sourceFormatForName(input.name);
      if (!format) throw new SourceAdapterError("unsupported_format", `不支持的文本格式：${input.name}`);
      try {
        return normalizeTextDocument(titleForName(input.name), input.text, format, input.name, this.id, this.version);
      } catch (error) {
        if (error instanceof SourceAdapterError) throw error;
        throw new SourceAdapterError("parse_failed", `无法解析 ${input.name}。`, error);
      }
    }

    async locate(anchor: SourceAnchor): Promise<SourceAnchor | null> {
      return anchor.kind === "line" ? anchor : null;
    }

    async dispose(): Promise<void> {
      return Promise.resolve();
    }
  }

  export function parsePlainText(title: string, rawText: string, sourceFormat: SourceFormat = "txt"): ParsedDocument {
    const sourceName = `${title.trim() || "未命名文档"}.${sourceFormat}`;
    const adapterId = sourceFormat === "txt" || sourceFormat === "md" ? TEXT_ADAPTER_ID : "tanyue.inline-text";
    return normalizeTextDocument(title, rawText, sourceFormat, sourceName, adapterId, TEXT_ADAPTER_VERSION);
  }
}
