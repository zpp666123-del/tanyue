namespace TanYueTests {
  test("普通文本拆分生成 100% 有效覆盖报告", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const document = await adapter.parse({
      name: "chapters.txt",
      text: "第一章\n\n道可道，非常道。\n\n第二章\n\n天下皆知美之为美，斯恶已。"
    });
    const result = TanYue.segmentDocument(document, 30, { sourceName: "chapters.txt" });

    equal(result.coverage.coveragePercent, 100, "覆盖率应为 100%");
    equal(result.coverage.gapCount, 0, "不应存在覆盖空洞");
    equal(result.coverage.duplicateRunCount, 0, "不应重复引用来源区间");
    equal(result.coverage.outOfOrderCount, 0, "不应乱序");
    assert(result.coverage.valid, "覆盖报告应有效");
    equal(result.segments.length, 2, "章节边界应保留");
  });

  test("超长正文拆分后可按来源区间完整重建", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const text = Array.from({ length: 80 }, (_, index) => `第${index + 1}句保持原文。`).join("");
    const document = await adapter.parse({ name: "long.txt", text });
    const result = TanYue.segmentDocument(document, 30, { sourceName: "long.txt" });
    const block = document.blocks.find((item) => item.type !== "heading");
    assert(block, "应存在正文块");
    const runs = result.segments.flatMap((segment) => segment.sourceRuns).filter((run) => run.blockId === block.id);
    const rebuilt = runs.map((run) => block.text.slice(run.startOffset, run.endOffset)).join("");

    assert(result.segments.length > 1, "超长正文应拆成多个片段");
    equal(rebuilt, block.text, "来源区间应完整重建正文块");
    assert(result.coverage.valid, "超长正文覆盖报告应有效");
  });

  test("相同文本位于不同来源块时只报告内容重复，不误判覆盖重复", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const document = await adapter.parse({ name: "repeat.txt", text: "相同的一段正文。\n\n相同的一段正文。" });
    const result = TanYue.segmentDocument(document, 30, { sourceName: "repeat.txt" });

    assert(result.warnings.some((warning) => warning.includes("重复内容")), "应给出相同内容警告");
    equal(result.coverage.duplicateRunCount, 0, "不同来源块不属于重复引用");
    assert(result.coverage.valid, "内容重复不应破坏来源覆盖完整性");
  });

  test("每个新片段包含完整处理追溯且 AI 字段为空", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const document = await adapter.parse({ name: "trace.md", text: "# 标题\n\n需要追溯的正文。" });
    const result = TanYue.segmentDocument(document, 60, { sourceName: "trace.md" });
    const trace = result.segments[0].processingTrace;

    equal(trace.parserId, adapter.id, "应记录解析器标识");
    equal(trace.parserVersion, adapter.version, "应记录解析器版本");
    assert(trace.segmenterVersion.length > 0 && trace.ruleVersion.length > 0, "应记录拆分器和规则版本");
    equal(trace.aiPromptVersion, null, "未调用 AI 时提示词版本应为 null");
    equal(trace.aiModel, null, "未调用 AI 时模型应为 null");
  });

  test("二十万字单块文本保持 100% 覆盖", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const text = "这是一段用于验证完整覆盖与顺序的非虚构文本。".repeat(10_000);
    const document = await adapter.parse({ name: "large.txt", text });
    const result = TanYue.segmentDocument(document, 60, { sourceName: "large.txt" });
    const coveredLength = result.segments
      .flatMap((segment) => segment.sourceRuns)
      .reduce((sum, run) => sum + run.endOffset - run.startOffset, 0);

    assert(text.length >= 200_000, "测试文本应达到二十万字级别");
    equal(result.coverage.coveragePercent, 100, "大文本覆盖率应为 100%");
    equal(coveredLength, document.blocks[0].text.length, "所有来源区间总长应等于原文块长度");
    assert(result.coverage.valid, "大文本完整性报告应有效");
  });
}
