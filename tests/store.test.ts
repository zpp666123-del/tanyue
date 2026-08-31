namespace TanYueTests {
  test("覆盖报告无效的导入不得写入状态", async () => {
    const adapter = new TanYue.PlainTextSourceAdapter();
    const document = await adapter.parse({ name: "invalid.txt", text: "正文内容。" });
    const result = TanYue.segmentDocument(document, 30, { sourceName: "invalid.txt" });
    result.coverage = { ...result.coverage, coveragePercent: 80, valid: false };
    const state = TanYue.createDemoState();
    const bookCount = state.books.length;

    throws(() => TanYue.addImportedContent(state, result), "完整性检查失败");
    equal(state.books.length, bookCount, "失败导入不得增加书籍");
  });

  test("展示不会自动确认，只有显式确认才进入 confirmed", () => {
    const state = TanYue.createDemoState();
    const segment = state.segments.find((item) => item.status === "unread");
    assert(segment, "应存在未读片段");

    TanYue.markShown(state, segment.id);
    equal(segment.status, "shown", "展示后只能是 shown");
    TanYue.markConfirmed(state, segment.id);
    equal(segment.status, "confirmed", "显式确认后才是 confirmed");
  });

  test("手动或自动收起弹窗后保留展示记录并把阅读位置推进到下一段", () => {
    const state = TanYue.createReleaseSeedState();
    const segments = TanYue.getBookSegments(state, state.activeBookId);
    const current = segments[0];
    TanYue.markShown(state, current.id);

    const next = TanYue.dismissPopupAndAdvance(state, current.id);

    equal(current.status, "shown", "收起不应伪装成主动确认");
    assert(current.dismissedAt, "收起后应记录已消费位置");
    equal(next?.id, segments[1].id, "下次应显示下一段");
    equal(state.currentSegmentId, segments[1].id, "全局阅读游标应同步推进");
    equal(TanYue.resumeSegmentForBook(state, state.activeBookId)?.id, segments[1].id, "重新进入书籍也应接着下一段");
    equal(TanYue.progressForBook(state, state.activeBookId).read, 1, "收起片段应计入已读进度");
  });

  test("旧片段回填追溯信息时保留阅读状态、收藏和笔记", () => {
    const source = TanYue.createDemoState().segments[0];
    const legacy = { ...source } as Partial<TanYue.Segment>;
    delete legacy.sourceRuns;
    delete legacy.processingTrace;
    const hydrated = TanYue.hydrateSegmentTrace(legacy as TanYue.Segment);

    equal(hydrated.status, source.status, "阅读状态应保留");
    equal(hydrated.favorite, source.favorite, "收藏应保留");
    equal(hydrated.note, source.note, "笔记应保留");
    equal(hydrated.processingTrace.parserVersion, "legacy-unversioned", "旧数据应明确标为未版本化");
    equal(hydrated.sourceRuns[0].endOffset, source.originalText.length, "旧原文应获得完整来源区间");
  });

  test("载入状态时会把旧版异常阅读字号收敛到安全范围", () => {
    const saved = TanYue.createDemoState();
    saved.settings.fontScale = 9;
    const hydrated = TanYue.hydrateAppState(saved);
    assert(hydrated, "完整状态应能载入");
    equal(hydrated.settings.fontScale, 1.5, "异常字号不得破坏阅读布局");
  });

  test("首页继续阅读只返回当前书", () => {
    const state = TanYue.createDemoState();
    const targetBook = state.books.find((book) => book.id !== state.activeBookId && !book.archived);
    assert(targetBook, "演示数据应至少包含两本可读书籍");
    const targetSegment = TanYue.getBookSegments(state, targetBook.id)[0];
    assert(targetSegment, "目标书籍应包含片段");

    TanYue.setCurrentSegment(state, targetSegment.id);
    const books = TanYue.booksForContinueReading(state, 1);

    equal(books[0]?.id, targetBook.id, "当前书必须排在继续阅读首位");
    equal(books.length, 1, "首页只应显示一本正在阅读的书");
  });

  test("书架排序始终固定当前书置顶，并能排序其余书籍", () => {
    const state = TanYue.createDemoState();
    const activeBooks = state.books.filter((book) => !book.archived);
    assert(activeBooks.length >= 3, "演示数据应至少包含三本可读书籍");
    const current = activeBooks[1];
    const currentSegment = TanYue.getBookSegments(state, current.id)[0];
    assert(currentSegment, "当前书应包含片段");
    TanYue.setCurrentSegment(state, currentSegment.id);

    const remaining = activeBooks.filter((book) => book.id !== current.id);
    remaining[0].title = "乙书";
    remaining[1].title = "甲书";
    remaining[0].lastOpenedAt = "2026-01-01T00:00:00.000Z";
    remaining[1].lastOpenedAt = "2026-08-01T00:00:00.000Z";

    const byTitle = TanYue.sortBooksForLibrary(state, "title");
    const byRecent = TanYue.sortBooksForLibrary(state, "recent");
    equal(byTitle[0].id, current.id, "按书名排序时当前书仍须置顶");
    equal(byTitle[1].id, remaining[1].id, "其余书籍应按书名排序");
    equal(byRecent[0].id, current.id, "按最近阅读排序时当前书仍须置顶");
    equal(byRecent[1].id, remaining[1].id, "其余书籍应按最近阅读时间排序");
  });

  test("每本书按独立历史位置接续，读完当前位置后进入下一段", () => {
    const state = TanYue.createDemoState();
    const book = state.books.find((item) => TanYue.getBookSegments(state, item.id).length >= 3);
    assert(book, "应存在至少三段的书籍");
    const segments = TanYue.getBookSegments(state, book.id);
    segments.forEach((segment) => { segment.status = "unread"; });
    segments[0].status = "confirmed";
    segments[1].status = "confirmed";
    book.currentSequence = 2;
    state.activeBookId = state.books.find((item) => item.id !== book.id)?.id || "";
    state.currentSegmentId = state.segments.find((segment) => segment.bookId === state.activeBookId)?.id || "";

    equal(TanYue.resumeSegmentForBook(state, book.id)?.id, segments[2].id, "已读位置之后应接着下一段");
    segments[2].status = "shown";
    book.currentSequence = 3;
    equal(TanYue.resumeSegmentForBook(state, book.id)?.id, segments[2].id, "只展示未确认的片段应继续停在原处");

    segments.forEach((segment) => { segment.status = "confirmed"; });
    equal(TanYue.resumeSegmentForBook(state, book.id)?.id, segments[0].id, "全书读完后才从第一段重新开始");
  });

  test("删除书籍会清除所属片段、进度事件、收藏和笔记并安全接续", () => {
    const state = TanYue.createDemoState();
    const removedBookId = state.activeBookId;
    const removedSegments = TanYue.getBookSegments(state, removedBookId);
    const removedIds = new Set(removedSegments.map((segment) => segment.id));
    removedSegments[0].favorite = true;
    removedSegments[0].note = "这条笔记应随书删除";
    const summary = TanYue.removeBook(state, removedBookId);

    assert(summary, "应返回删除摘要");
    equal(summary.segmentCount, removedSegments.length, "应报告实际删除片段数");
    equal(summary.favoriteCount >= 1, true, "应统计被删除收藏");
    equal(summary.noteCount >= 1, true, "应统计被删除笔记");
    assert(state.books.every((book) => book.id !== removedBookId), "书籍应从书架移除");
    assert(state.segments.every((segment) => segment.bookId !== removedBookId), "所属片段应全部移除");
    assert(state.events.every((event) => event.bookId !== removedBookId && (!event.segmentId || !removedIds.has(event.segmentId))), "所属行为记录应清除");
    assert(Boolean(TanYue.currentSegment(state)), "删除当前书后应接续到其他书");
    assert(state.activeBookId !== removedBookId, "活动书籍不得继续指向已删除书");
  });

  test("删除最后一本书后进入可重新导入的空状态", () => {
    const state = TanYue.createDemoState();
    state.schedule.nextDueAt = new Date().toISOString();
    state.schedule.lastTriggeredSlot = new Date().toISOString();
    [...state.books].forEach((book) => TanYue.removeBook(state, book.id));

    equal(state.books.length, 0, "书架应允许为空");
    equal(state.segments.length, 0, "空书架不得残留片段");
    equal(state.events.length, 0, "空书架不得残留书籍行为记录");
    equal(state.activeBookId, "", "活动书籍引用应清空");
    equal(state.currentSegmentId, "", "当前片段引用应清空");
    equal(TanYue.currentSegment(state), null, "空书架没有当前片段");
    equal(TanYue.currentBook(state), null, "空书架没有当前书籍");
    equal(state.schedule.nextDueAt, undefined, "空书架应清除待提醒时间");
    equal(state.schedule.lastTriggeredSlot, undefined, "空书架应清除触发槽位");
  });
}
