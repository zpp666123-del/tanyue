namespace TanYueTests {
  function scheduleFixture(): TanYue.ReadingSchedule {
    return {
      enabled: true,
      weekdays: [1, 2, 3, 4, 5],
      dailyCount: 5,
      displayMode: "adaptive",
      displaySeconds: 60,
      targetSeconds: 60,
      windows: [
        { id: "am", start: "09:30", end: "11:30", enabled: true, label: "上午" },
        { id: "pm", start: "14:00", end: "17:30", enabled: true, label: "下午" }
      ],
      quietStart: "22:30",
      quietEnd: "08:30"
    };
  }

  test("调度器生成严格递增的工作日提醒", () => {
    const slots = TanYue.generateDailySlots(new Date(2026, 7, 31, 8, 0), scheduleFixture());
    equal(slots.length, 5, "应生成五个提醒槽位");
    assert(slots.every((slot, index) => index === 0 || slot.at > slots[index - 1].at), "提醒应严格递增");
  });

  test("跨午夜安静时段正确生效", () => {
    const schedule = scheduleFixture();
    assert(TanYue.isQuietTime(new Date(2026, 7, 31, 23, 0), schedule), "深夜应安静");
    assert(TanYue.isQuietTime(new Date(2026, 7, 31, 7, 30), schedule), "清晨应安静");
    assert(!TanYue.isQuietTime(new Date(2026, 7, 31, 12, 0), schedule), "中午不应安静");
  });

  test("阅读时长估算具有下限", () => {
    assert(TanYue.estimateReadingSeconds("道可道，非常道。") >= 8, "估算时长不得低于八秒");
  });

  test("阅读字号设置覆盖明显范围并规范异常旧值", () => {
    equal(TanYue.normalizeReadingFontScale(0.3), 0.5, "过小字号应限制在低调阅读下限");
    equal(TanYue.normalizeReadingFontScale(1.27), 1.25, "字号应对齐到 5% 档位");
    equal(TanYue.normalizeReadingFontScale(2), 1.5, "过大字号应限制在布局上限");
    equal(TanYue.readingFontScaleProgress(0.5), 0, "最小字号应位于滑块起点");
    equal(TanYue.readingFontScaleProgress(1.5), 100, "最大字号应位于滑块终点");
    equal(TanYue.readingBodyLineHeight(0.5), 1.92, "极小字号应保留更舒展的行高");
    equal(TanYue.readingBodyLineHeight(1.5), 1.66, "大字号应自动收紧行高");
    equal(TanYue.readingLayoutDensity(0.5), 0.75, "极小字号应同步收紧内容留白");
    equal(TanYue.readingLayoutDensity(1), 1, "标准字号应保持标准内容留白");
  });

  test("书皮显示更多真实书名并把卷册分行", () => {
    equal(TanYue.bookCoverTitleLines("毛主席语录（正文版）").join("/"), "毛主席语录", "短书名应完整显示");
    equal(TanYue.bookCoverTitleLines("毛泽东选集 第三卷（正文版）").join("/"), "毛泽东选集/第三卷", "卷册应与主书名分行");
    equal(TanYue.bookCoverTitleLines("《道德经》").join("/"), "道德经", "书名号不应占用书皮空间");
    equal(TanYue.bookCoverTitleLines("专注工作方法手册").join("/"), "专注工作方/法手册", "长书名应显示至多两行");
  });

  test("阅读标题只显示未与正文重复的真实章节标题", () => {
    const state = TanYue.createDemoState();
    const first = state.segments.find((segment) => segment.bookId === "book_dao_de_jing")!;
    equal(TanYue.readingHeadingForSegment(state, first), "第一章", "章节首次出现时应显示真实标题");

    const continuation = { ...first, id: "same-chapter-next", sequence: first.sequence + 0.5 };
    state.segments.push(continuation);
    equal(TanYue.readingHeadingForSegment(state, continuation), null, "同一章节后续片段不应重复标题");

    const repeatedInBody = { ...first, originalText: `第一章\n\n${first.originalText}` };
    equal(TanYue.readingHeadingForSegment({ ...state, segments: [repeatedInBody] }, repeatedInBody), null, "正文已经包含标题时不应重复展示");
  });

  test("弹窗自适应时间使用预计阅读时长并允许短于三十秒", () => {
    const schedule = scheduleFixture();
    const segment = TanYue.createDemoState().segments[0];
    segment.estimatedSeconds = 8;
    equal(TanYue.popupDisplaySeconds(segment, schedule), 14, "短内容应在预计时间后保留轻量缓冲");
    schedule.displayMode = "fixed";
    schedule.displaySeconds = 45;
    equal(TanYue.popupDisplaySeconds(segment, schedule), 45, "固定模式应尊重用户设置");
  });

  test("读到一本书末尾后不会静默循环回第一段", () => {
    const state = TanYue.createDemoState();
    const segments = TanYue.getBookSegments(state, state.activeBookId);
    equal(TanYue.nextSegment(state, segments[segments.length - 1].id), null, "末段之后应进入完成状态");
    equal(TanYue.previousSegment(state, segments[0].id), null, "首段之前不应循环到末段");
  });

  test("延后和今天暂停统一返回当前有效阻塞状态", () => {
    const schedule = scheduleFixture();
    const now = new Date(2026, 7, 31, 10, 0);
    schedule.snoozeUntil = new Date(2026, 7, 31, 10, 30).toISOString();
    schedule.pausedUntil = new Date(2026, 8, 1, 0, 0).toISOString();
    const pause = TanYue.activeReminderPause(schedule, now);
    equal(pause?.kind, "today", "应展示持续时间更长的暂停状态");
  });

  test("状态广播忽略当前窗口自身事件并继续接收其他窗口", () => {
    const ownId = "main-window";
    assert(!TanYue.shouldHandleStateChanged({ source: ownId }, ownId), "自身保存后的广播不应反向覆盖内存状态");
    assert(TanYue.shouldHandleStateChanged({ source: "popup-window" }, ownId), "其他窗口的更新仍应同步");
    assert(TanYue.shouldHandleStateChanged({ at: 1 }, ownId), "旧版无来源事件仍应兼容");
  });
}
