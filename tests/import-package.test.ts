namespace TanYueTests {
  function validPackage(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      offsetUnit: "unicode-scalar",
      book: { title: "Agent 测试书", author: "测试作者" },
      source: {
        name: "agent-test.pdf",
        format: "pdf",
        mediaType: "application/pdf",
        sha256: "a".repeat(64)
      },
      processing: {
        parser: { id: "example.pdf-agent", version: "1.2.0" },
        segmenter: { id: "example.segmenter", version: "2.0.0", ruleVersion: "work-reading-v1" }
      },
      blocks: [
        {
          id: "page-1",
          sequence: 1,
          type: "paragraph",
          text: "第一段含有😀符号。",
          sourceAnchor: { kind: "page", value: "1", label: "第 1 页" }
        },
        {
          id: "page-2",
          sequence: 2,
          type: "paragraph",
          text: "第二段完整保留。",
          sourceAnchor: { kind: "page", value: "2", label: "第 2 页" }
        }
      ],
      segments: [
        { sequence: 1, chapterTitle: "开篇", spans: [{ blockId: "page-1", start: 0, end: 9 }] },
        { sequence: 2, chapterTitle: "继续", spans: [{ blockId: "page-2", start: 0, end: 8 }] }
      ]
    };
  }

  test("Agent 导入包按 Unicode 字符范围重建原文并达到 100% 覆盖", () => {
    const result = TanYue.importAgentPackage(JSON.stringify(validPackage()));
    equal(result.coverage.coveragePercent, 100, "覆盖率应为 100%");
    equal(result.coverage.gapCount, 0, "不应有空洞");
    equal(result.segments[0].originalText, "第一段含有😀符号。", "emoji 不应破坏跨语言 offset");
    equal(result.segments[0].processingTrace.parserId, "example.pdf-agent", "应保留外部解析器标识");
    equal(result.segments[0].processingTrace.segmenterVersion, "example.segmenter@2.0.0", "应保留外部切片器版本");
    equal(result.book.sourceHash, "a".repeat(64), "应保留原文件哈希");
  });

  test("Agent 导入包缺少正文覆盖时必须拒绝", () => {
    const source = validPackage();
    source.segments = [{ sequence: 1, spans: [{ blockId: "page-1", start: 0, end: 5 }] }];
    throws(() => TanYue.importAgentPackage(JSON.stringify(source)), "覆盖失败");
  });

  test("Agent 导入包使用非连续序号时必须拒绝", () => {
    const source = validPackage();
    const segments = source.segments as Array<Record<string, unknown>>;
    segments[1].sequence = 3;
    throws(() => TanYue.importAgentPackage(JSON.stringify(source)), "必须连续");
  });
}
