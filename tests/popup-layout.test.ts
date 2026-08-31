namespace TanYueTests {
  test("短片段使用紧凑弹窗宽度", () => {
    equal(TanYue.popupWidthForText("上善若水。水善利万物而不争。"), 480, "短中文片段应收紧宽度");
  });

  test("长片段扩展弹窗宽度但不超过上限", () => {
    equal(TanYue.popupWidthForText("道".repeat(260)), 600, "长片段应使用最大阅读宽度");
  });

  test("弹窗高度跟随实际内容并受屏幕约束", () => {
    equal(TanYue.popupHeightForContent(470.2, 1080), 471, "中等内容应按实际渲染高度适配");
    equal(TanYue.popupHeightForContent(1200, 700), 604, "长内容不得侵入屏幕保留区");
    equal(TanYue.popupHeightForContent(180, 1080), 340, "短内容不得小于可用操作下限");
  });

  test("用户可以限制弹窗占屏上限而不关闭内容自适应", () => {
    const longText = "道".repeat(260);
    equal(TanYue.popupWidthForText(longText, "compact"), 520, "紧凑模式应限制最大宽度");
    equal(TanYue.popupWidthForText(longText, "small"), 480, "小窗模式应限制最大宽度");
    equal(TanYue.popupHeightForContent(900, 1080, "compact"), 560, "紧凑模式应限制最大高度");
    equal(TanYue.popupHeightForContent(900, 1080, "small"), 460, "小窗模式应限制最大高度");
  });

  test("大字号在自适应模式下获得更多行宽但不突破占屏上限", () => {
    const shortText = "上善若水。水善利万物而不争。";
    equal(TanYue.popupWidthForText(shortText, "adaptive", 1.5), 540, "大字号短片段应适当增宽");
    equal(TanYue.popupWidthForText(shortText, "small", 1.5), 480, "小窗模式仍应严格遵守宽度上限");
  });

  test("倒计时进度始终使用本次弹窗的真实时长", () => {
    equal(TanYue.countdownProgressPercent(41, 41), 100, "首次显示应从完整进度开始");
    equal(TanYue.countdownProgressPercent(20.5, 41), 50, "经过一半时应显示一半进度");
    equal(TanYue.countdownProgressPercent(0, 41), 0, "倒计时结束时应归零");
    equal(TanYue.countdownProgressPercent(50, 41), 100, "异常超量值不得溢出轨道");
  });
}
