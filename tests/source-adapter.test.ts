namespace TanYueTests {
  test("TXT 适配器检测并生成带锚点的标准化正文块", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const input: TanYue.TextSourceInput = {
      name: "sample.txt",
      text: "第一章\n\n第一段正文。\n\n第二段正文。"
    };

    equal(await adapter.detect(input), 1, "TXT 应完全匹配");
    const document = await adapter.parse(input);
    equal(document.adapterId, adapter.id, "文档应记录适配器标识");
    equal(document.parserVersion, adapter.version, "文档应记录解析器版本");
    equal(document.blocks.length, 3, "应生成标题和两个正文块");
    assert(document.blocks.every((block) => block.contentHash.length > 0), "每个块应有内容哈希");
    assert(document.blocks.every((block) => block.sourceAnchor.kind === "line"), "每个块应有行号锚点");
    await adapter.dispose();
  });

  test("Markdown 适配器保留标题结构", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const document = await adapter.parse({ name: "notes.md", text: "# 标题\n\n正文内容。" });
    equal(document.sourceFormat, "md", "Markdown 扩展名应映射为 md");
    equal(document.blocks[0].type, "heading", "Markdown 标题应识别为 heading");
    equal(document.blocks[0].text, "标题", "标题标记不进入原文文字");
  });

  test("空文本返回明确适配器错误", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    await rejects(() => adapter.parse({ name: "empty.txt", text: " \r\n " }), "empty_source");
  });

  test("不支持的格式不会被文本适配器认领", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    equal(await adapter.detect({ name: "book.epub", text: "binary" }), 0, "EPUB 不应匹配文本适配器");
    await rejects(
      () => TanYue.selectSourceAdapter({ name: "book.epub", text: "binary" }, [adapter]),
      "unsupported_format"
    );
  });
}
