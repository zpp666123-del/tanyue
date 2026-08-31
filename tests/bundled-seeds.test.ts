namespace TanYueTests {
  function bundledSeedPackage(title = "内置测试书", body = "测试正文。"): string {
    return JSON.stringify({
      schemaVersion: 1,
      offsetUnit: "unicode-scalar",
      book: { title, author: "测试作者" },
      source: { name: "seed.md", format: "md", sha256: "b".repeat(64) },
      processing: {
        parser: { id: "test.seed", version: "1.0.0" },
        segmenter: { id: "test.segmenter", version: "1.0.0", ruleVersion: "test-v1" }
      },
      blocks: [{
        id: "block-1",
        sequence: 1,
        type: "paragraph",
        text: body,
        sourceAnchor: { kind: "chapter", value: "1", label: "第一章" }
      }],
      segments: [{ sequence: 1, chapterTitle: "第一章", spans: [{ blockId: "block-1", start: 0, end: Array.from(body).length }] }]
    });
  }

  test("内置书籍首次安装后进入书架且重复执行不重复添加", async () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      preferredBookTitle: "内置测试书",
      totalSegmentCount: 1,
      packages: [{ file: "seed.tanyue.json", title: "内置测试书", segmentCount: 1 }]
    });
    const responses = new Map<string, string>([
      ["https://example.test/seeds/manifest.json", manifest],
      ["https://example.test/seeds/seed.tanyue.json", bundledSeedPackage()]
    ]);
    const fetchSeed: TanYue.BundledSeedFetch = async (url) => ({
      ok: responses.has(url),
      status: responses.has(url) ? 200 : 404,
      text: async () => responses.get(url) || ""
    });
    const state = TanYue.createReleaseSeedState();

    await TanYue.installBundledSeeds(state, fetchSeed, "https://example.test/seeds/");
    await TanYue.installBundledSeeds(state, fetchSeed, "https://example.test/seeds/");

    equal(state.books.length, 2, "重复初始化不得重复添加书籍");
    equal(state.segments.length, 82, "应保留道德经并加入一个种子片段");
    equal(TanYue.currentBook(state)?.title, "内置测试书", "清单指定书籍应成为首次阅读目标");
    equal(state.events.length, 0, "种子安装不得伪装成用户导入活动");
    equal(state.contentSeedVersion, TanYue.BUNDLED_SEED_VERSION, "种子版本必须持久化");
  });

  test("内置内容升级替换旧语录且不改变当前阅读目标", async () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      preferredBookTitle: "内置测试书",
      totalSegmentCount: 1,
      packages: [{ file: "seed.tanyue.json", title: "内置测试书", segmentCount: 1 }]
    });
    const responses = new Map<string, string>([
      ["https://example.test/seeds/manifest.json", manifest],
      ["https://example.test/seeds/seed.tanyue.json", bundledSeedPackage()]
    ]);
    const fetchSeed: TanYue.BundledSeedFetch = async (url) => ({
      ok: responses.has(url),
      status: responses.has(url) ? 200 : 404,
      text: async () => responses.get(url) || ""
    });
    const state = TanYue.createReleaseSeedState();
    const currentId = state.currentSegmentId;
    const old = TanYue.importAgentPackage(bundledSeedPackage("毛主席语录（1966年版）", "旧版正文。"));
    TanYue.addImportedContent(state, old, { activate: false, recordEvent: false });

    await TanYue.installBundledSeeds(state, fetchSeed, "https://example.test/seeds/", true);

    equal(state.books.some((book) => book.title === "毛主席语录（1966年版）"), false, "旧语录必须移除");
    equal(state.books.some((book) => book.title === "内置测试书"), true, "新种子必须加入");
    equal(state.currentSegmentId, currentId, "升级不得打断当前阅读目标");
  });
}
