namespace TanYueTests {
  test("更新累计下载字节，下载阶段不会提前安装", async () => {
    const calls: string[] = [];
    const progress: TanYue.UpdateDownloadProgress[] = [];
    const update: TanYue.UpdaterUpdate = {
      version: "0.2.5", currentVersion: "0.2.4", date: null,
      download: async (emit) => {
        emit({ event: "Started", data: { contentLength: 100 } });
        emit({ event: "Progress", data: { chunkLength: 30 } });
        emit({ event: "Progress", data: { chunkLength: 70 } });
        emit({ event: "Finished", data: {} });
      },
      install: async () => { calls.push("install"); },
      close: async () => { calls.push("close"); }
    };
    (globalThis as unknown as { window: unknown }).window = { __TAURI__: {
      updater: { check: async () => update }, process: { relaunch: async () => { calls.push("relaunch"); } }
    } };
    await TanYue.UpdaterBridge.check();
    await TanYue.UpdaterBridge.download((item) => progress.push(item));
    equal(progress[1].percent, 30, "首个数据块应为 30%");
    equal(progress[2].downloaded, 100, "必须累加所有数据块");
    equal(progress[3].total, 100, "完成时保留真实大小");
    equal(calls.length, 0, "下载不能自动安装或退出");
    await TanYue.UpdaterBridge.relaunch();
    equal(calls.join(","), "install,relaunch", "用户点击安装后再安装重启");
    (globalThis as unknown as { window: unknown }).window = {};
  });
  const updateAnnouncement: TanYue.UpdateAnnouncement = {
    version: "0.2.4",
    notes: "新增应用内检查更新",
    pubDate: "2026-09-03T00:00:00Z",
    currentVersion: "0.2.3"
  };

  test("更新状态机：初始为 idle，填充桌面版本不改变阶段", () => {
    const initial = TanYue.createInitialUpdateUi();
    equal(initial.phase, "idle", "初始阶段应为 idle");
    equal(initial.announcement, null, "初始不应有新版本公告");
    const filled = TanYue.reduceUpdateUi(initial, { type: "fill-version", version: "0.2.4" });
    equal(filled.currentVersion, "0.2.4", "桌面实际版本应被填充");
    equal(filled.phase, "idle", "填充版本不应改变阶段");
    equal(initial.currentVersion, null, "原状态不应被就地修改");
  });

  test("更新状态机：检查后无更新进入 up-to-date", () => {
    const state = TanYue.reduceUpdateUi(
      TanYue.reduceUpdateUi(TanYue.createInitialUpdateUi(), { type: "check-start" }),
      { type: "check-done-none" }
    );
    equal(state.phase, "up-to-date", "无更新应显示已是最新");
    equal(state.announcement, null, "无更新时不应留下公告");
  });

  test("更新状态机：检查发现新版本进入 available 并保留公告", () => {
    const state = TanYue.reduceUpdateUi(
      TanYue.reduceUpdateUi(TanYue.createInitialUpdateUi(), { type: "check-start" }),
      { type: "check-done-found", announcement: updateAnnouncement }
    );
    equal(state.phase, "available", "发现新版本应进入可下载阶段");
    equal(state.announcement?.version, "0.2.4", "公告应携带新版本号");
    equal(state.announcement?.currentVersion, "0.2.3", "公告应携带当前版本号");
  });

  test("更新状态机：检查失败进入 error，重试回到 checking", () => {
    const failed = TanYue.reduceUpdateUi(TanYue.createInitialUpdateUi(), {
      type: "check-failed",
      message: "网络不可达"
    });
    equal(failed.phase, "error", "失败应进入错误阶段");
    equal(failed.error, "网络不可达", "错误信息应保留");
    const retried = TanYue.reduceUpdateUi(failed, { type: "check-start" });
    equal(retried.phase, "checking", "重试应回到检查中");
    equal(retried.error, null, "重试应清空错误");
  });

  test("更新状态机：下载进度折算百分比，完成后进入 ready", () => {
    let state = TanYue.reduceUpdateUi(TanYue.createInitialUpdateUi(), {
      type: "check-done-found",
      announcement: updateAnnouncement
    });
    state = TanYue.reduceUpdateUi(state, { type: "download-start" });
    equal(state.phase, "downloading", "开始下载应进入下载阶段");
    state = TanYue.reduceUpdateUi(state, {
      type: "download-progress",
      progress: { downloaded: 50, total: 100, percent: 50 }
    });
    equal(state.progress?.percent, 50, "进度应保留百分比");
    state = TanYue.reduceUpdateUi(state, { type: "download-done" });
    equal(state.phase, "ready", "下载完成应进入就绪阶段");
    equal(state.progress?.percent, 100, "完成后进度应为 100%");
  });

  test("更新状态机：下载失败进入 error 且可重试下载", () => {
    const failed = TanYue.reduceUpdateUi(TanYue.createInitialUpdateUi(), {
      type: "download-failed",
      message: "下载中断"
    });
    equal(failed.phase, "error", "下载失败应进入错误阶段");
    const retried = TanYue.reduceUpdateUi(failed, { type: "download-start" });
    equal(retried.phase, "downloading", "重试下载应回到下载阶段");
  });

  test("更新状态机：不支持时给出桌面版提示", () => {
    const state = TanYue.reduceUpdateUi(TanYue.createInitialUpdateUi(), { type: "unsupported" });
    equal(state.phase, "error", "不支持时应进入错误阶段");
    assert((state.error || "").includes("桌面安装版"), "提示应引导使用桌面安装版");
  });

  test("更新 UI 下载大小格式化", () => {
    equal(TanYue.formatDownloadSize(0), "0 MB", "零字节应显示 0 MB");
    equal(TanYue.formatDownloadSize(512 * 1024), "512 KB", "小于 1MB 应按 KB 显示");
    equal(TanYue.formatDownloadSize(15 * 1024 * 1024), "15.0 MB", "大于 1MB 应按 MB 显示一位小数");
  });

  test("桌面桥接在无 Tauri 环境安全降级", async () => {
    (globalThis as unknown as { window?: unknown }).window = {};
    equal(TanYue.UpdaterBridge.isSupported(), false, "无 Tauri 时更新能力应判定为不可用");
    equal(
      await TanYue.UpdaterBridge.check(),
      null,
      "无 Tauri 时检查更新应安全返回 null 而非抛错"
    );
    equal(await TanYue.UpdaterBridge.currentVersion(), null, "无 Tauri 时版本读取应为 null");
  });
}
