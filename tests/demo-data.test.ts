namespace TanYueTests {
  test("《道德经》八十一章无漏段、无重复、顺序连续", () => {
    const demo = TanYue.createDemoState();
    const segments = demo.segments
      .filter((segment) => segment.bookId === "book_dao_de_jing")
      .sort((left, right) => left.sequence - right.sequence);

    equal(segments.length, 81, "应包含完整八十一章");
    equal(segments[0]?.chapterTitle, "第一章", "首章应正确");
    equal(segments[80]?.chapterTitle, "第八十一章", "末章应正确");
    assert(segments.every((segment, index) => segment.sequence === index + 1), "章节顺序应连续");
    assert(segments.every((segment) => segment.originalText.trim().length > 0), "章节不得为空");
    equal(new Set(segments.map((segment) => segment.contentHash)).size, 81, "章节指纹不得重复");
  });

  test("发行种子只带干净《道德经》且不携带演示进度", () => {
    const state = TanYue.createReleaseSeedState();
    equal(state.books.length, 1, "基础发行种子只应包含《道德经》");
    equal(state.books[0].title, "道德经", "基础发行种子书名应正确");
    equal(state.segments.length, 81, "应保留完整八十一章");
    assert(state.segments.every((segment) => segment.status === "unread"), "所有章节应从未读开始");
    assert(state.segments.every((segment) => !segment.favorite && !segment.note), "不得携带收藏和笔记");
    equal(state.events.length, 0, "不得携带演示活动记录");
  });
}
