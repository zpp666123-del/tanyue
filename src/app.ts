namespace TanYue {
  class AppController {
    private state: AppState;
    private popup: ReadingPopupController;
    private floating: FloatingWidgetController;
    private importDuration: 30 | 60 | 90;
    private librarySortMode: LibrarySortMode = "recent";
    private schedulerTimer: number | null = null;
    private pendingImportTimer: number | null = null;
    private processingPendingImports = false;
    private activeReaderSegmentId: string | null = null;
    private unlistenState: (() => void) | null = null;
    private unlistenTray: (() => void) | null = null;
    private unlistenOpenReader: (() => void) | null = null;
    private unlistenOpenHome: (() => void) | null = null;
    private unlistenAppearancePreview: (() => void) | null = null;
    private persistence: StatePersistence;
    private persistenceCoordinator: PersistenceCoordinator;

    constructor() {
      this.state = createReleaseSeedState();
      this.persistence = new BrowserLocalStorageRepository(window.localStorage);
      this.persistenceCoordinator = new PersistenceCoordinator(this.persistence);
      this.importDuration = this.state.schedule.targetSeconds;
      this.popup = new ReadingPopupController(
        () => this.state,
        (nextState) => this.commit(nextState, false),
        (segmentId) => this.openReader(segmentId),
        () => this.openHome(),
        isPopupMode()
      );
      this.floating = new FloatingWidgetController(
        () => this.state,
        () => this.showPopup()
      );
    }

    async start(): Promise<void> {
      try {
        const initialized = await initializeStatePersistence(window.localStorage, this.state);
        this.persistence = initialized.repository;
        this.persistenceCoordinator = new PersistenceCoordinator(this.persistence, (error) => {
          console.error("Failed to persist app state", error);
        });
        this.state = initialized.state;
        if (initialized.createdFresh) {
          try {
            await installBundledSeeds(this.state);
            await this.persistence.save(this.state);
          } catch (error) {
            await this.persistence.reset();
            throw new Error(`内置书籍初始化失败：${error instanceof Error ? error.message : String(error)}`);
          }
        } else if (this.state.contentSeedVersion < BUNDLED_SEED_VERSION) {
          try {
            await installBundledSeeds(this.state, undefined, undefined, true);
            await this.persistence.save(this.state);
          } catch (error) {
            throw new Error(`内置书籍升级失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }
        this.importDuration = this.state.schedule.targetSeconds;
        if (initialized.migration?.status === "migrated" && !isPopupMode() && !isFloatingMode()) {
          window.setTimeout(() => toast("旧版数据已安全迁移到 SQLite，并保留了恢复备份", "success"), 0);
        }
      } catch (error) {
        console.error("Failed to initialize persistence", error);
        const message = error instanceof Error ? error.message : "未知错误";
        document.body.innerHTML = `<main class="startup-error"><h1>无法打开本地数据</h1><p>${escapeHtml(message)}</p><p>原有 LocalStorage 数据没有被删除。</p></main>`;
        return;
      }
      this.applyAppearance();

      if (isFloatingMode()) {
        document.body.innerHTML = "";
        this.floating.mountStandalone();
        await this.setupDesktopListeners();
        return;
      }

      if (isPopupMode()) {
        document.body.innerHTML = "";
        this.bindGlobalEvents();
        await this.setupDesktopListeners();
        this.popup.show();
        return;
      }

      this.render();
      this.bindGlobalEvents();
      await this.setupDesktopListeners();
      this.startScheduler();
      const actualAutostart = await DesktopBridge.getAutostart();
      if (actualAutostart !== null && actualAutostart !== this.state.settings.autostart) {
        this.state.settings.autostart = actualAutostart;
        this.commit(this.state);
      }
      if (DesktopBridge.isTauri()) {
        await DesktopBridge.setFloatingWidget(this.state.settings.floatingWidget);
        await this.processPendingImportPackages();
        this.pendingImportTimer = window.setInterval(() => void this.processPendingImportPackages(), 2_000);
      }
    }

    private render(): void {
      let root = document.querySelector<HTMLElement>("#app");
      if (!root) {
        root = document.createElement("div");
        root.id = "app";
        document.body.prepend(root);
      }
      const previousHost = root.querySelector<HTMLElement>("#view-host");
      const previousView = previousHost?.dataset.renderedView;
      const previousScrollTop = previousHost?.scrollTop || 0;
      root.innerHTML = renderAppShell(this.state);
      const nextHost = root.querySelector<HTMLElement>("#view-host");
      if (nextHost) {
        nextHost.dataset.renderedView = this.state.selectedView;
        if (previousView === this.state.selectedView) nextHost.scrollTop = previousScrollTop;
      }
      this.applyAppearance();
      this.applyLibrarySort();
      this.floating.mountOverlay(this.state.settings.floatingWidget);
      if (this.activeReaderSegmentId) this.openReader(this.activeReaderSegmentId, true);
    }

    private async commit(state = this.state, rerender = true): Promise<boolean> {
      this.state = state;
      if (rerender) {
        if (isFloatingMode()) this.floating.refresh();
        else if (!isPopupMode()) this.render();
      }
      try {
        await this.persistenceCoordinator.save(this.state);
        await DesktopBridge.emitStateChanged();
        return true;
      } catch (error) {
        console.error("Failed to save app state", error);
        toast("本地保存失败；本次修改尚未安全写入", "warning");
        return false;
      }
    }

    private applyAppearance(): void {
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const dark = this.state.settings.theme === "dark" || (this.state.settings.theme === "system" && prefersDark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      this.state.settings.fontScale = normalizeReadingFontScale(this.state.settings.fontScale);
      document.documentElement.style.setProperty("--font-scale", String(this.state.settings.fontScale));
      document.documentElement.style.setProperty("--reading-body-leading", String(readingBodyLineHeight(this.state.settings.fontScale)));
      document.documentElement.style.setProperty("--reading-layout-density", String(readingLayoutDensity(this.state.settings.fontScale)));
      document.documentElement.classList.toggle("reduce-motion", this.state.settings.reduceMotion);
    }

    private bindGlobalEvents(): void {
      document.addEventListener("click", (event) => void this.onClick(event));
      document.addEventListener("change", (event) => void this.onChange(event));
      document.addEventListener("input", (event) => this.onInput(event));
      document.addEventListener("focusout", (event) => this.onFocusOut(event));
      document.addEventListener("keydown", (event) => void this.onKeyDown(event));
      document.addEventListener("dragover", (event) => {
        const zone = (event.target as HTMLElement | null)?.closest("#drop-zone");
        if (!zone) return;
        event.preventDefault();
        zone.classList.add("dragging");
      });
      document.addEventListener("dragleave", (event) => {
        (event.target as HTMLElement | null)?.closest("#drop-zone")?.classList.remove("dragging");
      });
      document.addEventListener("drop", (event) => {
        const zone = (event.target as HTMLElement | null)?.closest("#drop-zone");
        if (!zone) return;
        event.preventDefault();
        zone.classList.remove("dragging");
        const files = (event as DragEvent).dataTransfer?.files;
        if (files?.length) void this.importFiles(Array.from(files));
      });
    }

    private async onClick(event: MouseEvent): Promise<void> {
      const target = event.target as HTMLElement | null;
      const actionNode = target?.closest<HTMLElement>("[data-action]");
      if (!actionNode) return;
      const action = actionNode.dataset.action || "";

      if (action === "close-modal" && target?.classList.contains("modal-backdrop") === false && actionNode.classList.contains("modal-backdrop")) return;
      event.preventDefault();

      switch (action) {
        case "navigate": {
          const view = actionNode.dataset.view as ViewId | undefined;
          if (view && view !== this.state.selectedView) {
            this.state.selectedView = view;
            this.commit();
          }
          break;
        }
        case "toggle-theme": {
          this.state.settings.theme = this.state.settings.theme === "dark" ? "light" : "dark";
          this.commit();
          break;
        }
        case "set-theme": {
          const theme = actionNode.dataset.theme as ThemeMode | undefined;
          if (theme) {
            this.state.settings.theme = theme;
            this.commit();
          }
          break;
        }
        case "set-reading-font": {
          this.state.settings.readingFont = actionNode.dataset.font === "sans" ? "sans" : "serif";
          this.commit();
          break;
        }
        case "set-popup-size": {
          const size = actionNode.dataset.popupSize as PopupSizeMode | undefined;
          if (size && ["adaptive", "compact", "small"].includes(size)) {
            this.state.settings.popupSizeMode = size;
            this.commit();
          }
          break;
        }
        case "show-reading-popup":
          await this.showPopup();
          break;
        case "open-import":
          appendModal(renderImportModal(this.state));
          break;
        case "close-modal":
          closeModal();
          break;
        case "set-import-duration": {
          const seconds = Number(actionNode.dataset.seconds) as 30 | 60 | 90;
          if ([30, 60, 90].includes(seconds)) {
            this.importDuration = seconds;
            this.state.schedule.targetSeconds = seconds;
            document.querySelectorAll("[data-action='set-import-duration']").forEach((node) => node.classList.toggle("active", (node as HTMLElement).dataset.seconds === String(seconds)));
            await this.commit(this.state, false);
          }
          break;
        }
        case "open-book": {
          const bookId = actionNode.dataset.bookId;
          if (bookId) appendModal(renderBookModal(this.state, bookId));
          break;
        }
        case "request-delete-book": {
          const bookId = actionNode.dataset.bookId;
          if (bookId) appendModal(renderDeleteBookModal(this.state, bookId));
          break;
        }
        case "cancel-delete-book": {
          const bookId = actionNode.dataset.bookId;
          if (bookId) appendModal(renderBookModal(this.state, bookId));
          else closeModal();
          break;
        }
        case "confirm-delete-book": {
          const bookId = actionNode.dataset.bookId;
          if (!bookId) break;
          const previous = deepClone(this.state);
          const removed = removeBook(this.state, bookId);
          if (!removed) {
            closeModal();
            toast("这本书已经不在书架中", "neutral");
            break;
          }
          closeModal();
          if (!await this.commit()) {
            this.state = previous;
            this.render();
            break;
          }
          await DesktopBridge.hideReadingPopup();
          toast(`已删除《${removed.book.title}》及 ${removed.segmentCount} 个片段`, "success");
          break;
        }
        case "continue-book": {
          const bookId = actionNode.dataset.bookId;
          const target = bookId ? await this.continueBook(bookId) : null;
          if (!target) {
            toast("这本书没有可阅读片段", "warning");
            break;
          }
          closeModal();
          await this.showPopup();
          break;
        }
        case "select-segment": {
          const segmentId = actionNode.dataset.segmentId;
          if (segmentId) {
            setCurrentSegment(this.state, segmentId);
            this.commit();
          }
          break;
        }
        case "open-segment": {
          const segmentId = actionNode.dataset.segmentId;
          const segment = this.state.segments.find((item) => item.id === segmentId);
          if (!segment) break;
          const previous = deepClone(this.state);
          setCurrentSegment(this.state, segment.id);
          if (!await this.commit(this.state, false)) {
            this.state = previous;
            break;
          }
          closeModal();
          this.openReader(segment.id);
          const book = this.state.books.find((item) => item.id === segment.bookId);
          toast(`已切换至《${book?.title || "当前书"}》第 ${segment.sequence} 段`, "success");
          break;
        }
        case "open-reader":
          this.openReader();
          break;
        case "close-reader":
          this.closeReader(event, actionNode);
          break;
        case "reader-next": {
          const currentId = actionNode.dataset.segmentId || this.state.currentSegmentId;
          const completedBook = currentBook(this.state);
          if (!completedBook) {
            this.closeReader(event, actionNode);
            break;
          }
          markConfirmed(this.state, currentId);
          const next = nextSegment(this.state, currentId);
          if (!next) {
            const nextUnread = firstUnreadSegment(this.state, this.state.activeBookId, completedBook.id);
            if (nextUnread) setCurrentSegment(this.state, nextUnread.id);
            await this.commit(this.state, false);
            this.closeReader(event, actionNode);
            toast(`已读完《${completedBook.title}》`, "success");
            break;
          }
          setCurrentSegment(this.state, next.id);
          this.commit(this.state, false);
          this.replaceReader(next.id);
          break;
        }
        case "reader-prev": {
          const prev = previousSegment(this.state, actionNode.dataset.segmentId);
          if (!prev) break;
          setCurrentSegment(this.state, prev.id);
          this.commit(this.state, false);
          this.replaceReader(prev.id);
          break;
        }
        case "toggle-favorite": {
          const segmentId = actionNode.dataset.segmentId;
          if (segmentId) {
            const active = toggleFavorite(this.state, segmentId);
            this.commit(this.state, !document.querySelector(".reader-backdrop"));
            if (document.querySelector(".reader-backdrop")) this.replaceReader(segmentId);
            toast(active ? "已收藏这一段" : "已取消收藏", "success");
          }
          break;
        }
        case "edit-note": {
          const segmentId = actionNode.dataset.segmentId;
          if (segmentId) appendModal(renderNoteModal(this.state, segmentId));
          break;
        }
        case "save-note": {
          const segmentId = actionNode.dataset.segmentId;
          const textarea = document.querySelector<HTMLTextAreaElement>("#modal-note");
          const segment = this.state.segments.find((item) => item.id === segmentId);
          if (segment && textarea) {
            segment.note = textarea.value.trim();
            this.commit();
            closeModal();
            toast("笔记已保存在本机", "success");
          }
          break;
        }
        case "snooze": {
          const minutes = Number(actionNode.dataset.minutes || 30);
          this.snooze(minutes);
          break;
        }
        case "pause-today":
          this.pauseToday();
          break;
        case "resume-reminders":
          this.state.schedule.snoozeUntil = undefined;
          this.state.schedule.pausedUntil = undefined;
          this.commit();
          toast("自动提醒已恢复", "success");
          break;
        case "toggle-weekday": {
          const day = Number(actionNode.dataset.day);
          const set = new Set(this.state.schedule.weekdays);
          if (set.has(day)) set.delete(day); else set.add(day);
          this.state.schedule.weekdays = Array.from(set).sort((a, b) => a - b);
          this.commit();
          break;
        }
        case "add-window":
          this.state.schedule.windows.push({ id: uid("window"), start: "16:00", end: "17:30", enabled: true, label: "傍晚" });
          this.commit();
          break;
        case "remove-window": {
          const windowId = actionNode.dataset.windowId;
          if (windowId && this.state.schedule.windows.length > 1) {
            this.state.schedule.windows = this.state.schedule.windows.filter((item) => item.id !== windowId);
            this.commit();
          } else toast("至少保留一个时段", "warning");
          break;
        }
        case "export-favorites":
          this.exportFavorites();
          break;
        case "export-data":
          downloadText(`弹阅数据-${localDateKey()}.json`, JSON.stringify(this.state, null, 2), "application/json;charset=utf-8");
          toast("数据导出已开始", "success");
          break;
        case "reset-demo":
          if (window.confirm("恢复初始内容会清除弹阅中的导入、进度、收藏和笔记。确定继续吗？")) {
            await this.persistence.reset();
            this.state = createReleaseSeedState();
            try {
              await installBundledSeeds(this.state);
              if (await this.commit()) toast("已恢复内置书籍", "success");
            } catch (error) {
              toast(`恢复失败：${error instanceof Error ? error.message : String(error)}`, "warning");
            }
          }
          break;
        case "focus-search":
          this.state.selectedView = "library";
          this.commit();
          window.setTimeout(() => document.querySelector<HTMLInputElement>("#library-search")?.focus(), 40);
          break;
        case "open-source-url": {
          const url = actionNode.dataset.url;
          if (url) await DesktopBridge.openUrl(url);
          break;
        }
        default:
          break;
      }
    }

    private async onChange(event: Event): Promise<void> {
      const element = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (!element) return;

      if (element.id === "file-input" && element instanceof HTMLInputElement && element.files?.length) {
        await this.importFiles(Array.from(element.files));
        return;
      }

      if (element.id === "library-sort") {
        const mode = element.value as LibrarySortMode;
        if (["recent", "imported", "progress", "title"].includes(mode)) {
          this.librarySortMode = mode;
          this.applyLibrarySort();
        }
        return;
      }

      const setting = element.dataset.setting;
      if (setting) {
        await this.updateSetting(setting, element);
        return;
      }

      const windowField = element.dataset.windowField as keyof TimeWindow | undefined;
      const windowId = element.dataset.windowId;
      if (windowField && windowId) {
        const item = this.state.schedule.windows.find((entry) => entry.id === windowId);
        if (!item) return;
        if (windowField === "enabled") item.enabled = (element as HTMLInputElement).checked;
        else if (windowField === "start" || windowField === "end" || windowField === "label") item[windowField] = element.value;
        this.commit();
      }
    }

    private onInput(event: Event): void {
      const element = event.target as HTMLInputElement | null;
      if (!element) return;
      if (element.id === "library-search") this.filterCards("#book-grid", element.value);
      if (element.id === "book-segment-search") this.filterCards("#book-segment-list", element.value);
      if (element.id === "favorite-search") this.filterCards("#favorite-list", element.value);
      if (element.dataset.setting === "schedule.dailyCount") {
        const value = document.querySelector("#daily-count-value");
        if (value) value.textContent = element.value;
      }
      if (element.dataset.setting === "settings.fontScale") {
        const scale = normalizeReadingFontScale(element.value);
        const percent = Math.round(scale * 100);
        this.state.settings.fontScale = scale;
        document.documentElement.style.setProperty("--font-scale", String(scale));
        document.documentElement.style.setProperty("--reading-body-leading", String(readingBodyLineHeight(scale)));
        document.documentElement.style.setProperty("--reading-layout-density", String(readingLayoutDensity(scale)));
        element.style.setProperty("--range-progress", `${readingFontScaleProgress(scale)}%`);
        element.setAttribute("aria-valuetext", `${percent}%`);
        const value = document.querySelector<HTMLElement>("#font-scale-value");
        if (value) value.textContent = `当前 ${percent}% · 调整时弹窗即时变化`;
        void DesktopBridge.emitReadingAppearancePreview(scale);
      }
    }

    private onFocusOut(event: FocusEvent): void {
      const textarea = event.target as HTMLTextAreaElement | null;
      if (textarea?.id !== "reader-note") return;
      const segment = this.state.segments.find((item) => item.id === textarea.dataset.segmentId);
      if (!segment) return;
      segment.note = textarea.value.trim();
      this.commit(this.state, false);
      toast("笔记已自动保存", "success");
    }

    private async onKeyDown(event: KeyboardEvent): Promise<void> {
      if (event.key === "Escape") {
        if (document.querySelector("#reading-popup-layer")) this.popup.close();
        else if (document.querySelector(".modal-backdrop")) closeModal();
        else document.querySelector(".reader-backdrop")?.remove();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        await this.showPopup();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.state.selectedView = "library";
        this.commit();
        window.setTimeout(() => document.querySelector<HTMLInputElement>("#library-search")?.focus(), 30);
      }
    }

    private async updateSetting(path: string, element: HTMLInputElement | HTMLSelectElement): Promise<void> {
      const checked = element instanceof HTMLInputElement && element.type === "checkbox" ? element.checked : undefined;
      const raw: string | boolean = checked === undefined ? element.value : checked;

      if (!path.includes(".")) {
        const key = path as keyof AppSettings;
        (this.state.settings as unknown as Record<string, string | number | boolean>)[key] = raw;
        if (key === "autostart") {
          const actual = await DesktopBridge.setAutostart(Boolean(raw));
          if (DesktopBridge.isTauri()) this.state.settings.autostart = actual;
          else toast("偏好已保存；打包为桌面版后由系统启动项生效", "neutral");
        }
        if (key === "floatingWidget" && DesktopBridge.isTauri()) {
          await DesktopBridge.setFloatingWidget(Boolean(raw));
        }
      } else {
        const [root, key] = path.split(".");
        if (root === "schedule") {
          const scheduleRecord = this.state.schedule as unknown as Record<string, string | number | boolean>;
          scheduleRecord[key] = element instanceof HTMLInputElement && element.type === "range" ? Number(element.value) : raw;
        }
        if (root === "settings") {
          const settingsRecord = this.state.settings as unknown as Record<string, string | number | boolean>;
          const value = element instanceof HTMLInputElement && element.type === "range" ? Number(element.value) : raw;
          settingsRecord[key] = key === "fontScale" ? normalizeReadingFontScale(value) : value;
        }
      }
      this.commit();
    }

    private async showPopup(automatic = false): Promise<void> {
      if (automatic) {
        const unread = firstUnreadSegment(this.state);
        if (!unread) return;
        if (unread.id !== this.state.currentSegmentId) {
          setCurrentSegment(this.state, unread.id);
          if (!await this.commit(this.state, false)) return;
        }
      }
      const segment = currentSegment(this.state);
      if (!segment) {
        this.state.selectedView = "library";
        await this.commit(this.state, !isPopupMode() && !isFloatingMode());
        if (DesktopBridge.isTauri()) {
          await DesktopBridge.hideReadingPopup();
          await DesktopBridge.showMainWindow();
        }
        if (!isPopupMode() && !isFloatingMode()) toast("书架是空的，请先导入阅读内容", "neutral");
        return;
      }
      if (this.state.settings.nativeNotifications) {
        await DesktopBridge.notify(`${BRAND.name} · ${segment.chapterTitle}`, segment.helperTitle);
      }
      if (DesktopBridge.isTauri()) {
        const shown = await DesktopBridge.showReadingPopup();
        if (shown) return;
      }
      if (!isFloatingMode()) this.popup.show();
    }

    private async importFiles(files: File[]): Promise<void> {
      const supported = files.filter((file) => /\.(txt|md|markdown|json)$/i.test(file.name));
      const unsupported = files.filter((file) => !/\.(txt|md|markdown|json)$/i.test(file.name));
      if (unsupported.length) toast("请让 Agent 将原文件转换为 .tanyue.json 后再导入", "warning");
      if (!supported.length) return;

      let imported = 0;
      let readableBlocks = 0;
      let generatedSegments = 0;
      let warningCount = 0;
      for (const file of supported) {
        try {
          let result: ImportResult;
          if (/\.json$/i.test(file.name)) {
            const raw = await file.text();
            const parsed = JSON.parse(raw) as Partial<AppState> | { title?: string; text?: string } | Record<string, unknown>;
            if (looksLikeAgentImportPackage(parsed)) {
              result = importAgentPackage(raw);
            } else {
            if (Array.isArray((parsed as Partial<AppState>).books) && Array.isArray((parsed as Partial<AppState>).segments)) {
              toast("当前版本不自动合并完整状态文件，请使用 TXT 或 Markdown 导入内容", "warning");
              continue;
            }
            const text = (parsed as { text?: string }).text;
            if (!text) throw new Error("JSON 中缺少 text 字段");
            const title = (parsed as { title?: string }).title || file.name.replace(/\.json$/i, "");
            const document = parsePlainText(title, text, "json");
            result = segmentDocument(document, this.importDuration, { sourceName: file.name });
            }
          } else {
            result = await importTextDocument(file.name, await file.text(), this.importDuration);
          }
          if (this.state.books.some((book) => book.id === result.book.id)) {
            toast(`${result.book.title} 已经导入，无需重复添加`, "neutral");
            continue;
          }
          addImportedContent(this.state, result);
          readableBlocks += result.coverage.readableBlockCount;
          generatedSegments += result.coverage.segmentCount;
          warningCount += result.warnings.length;
          imported += 1;
        } catch (error) {
          console.error(error);
          toast(`${file.name} 导入失败：${error instanceof Error ? error.message : "未知错误"}`, "warning");
        }
      }
      if (imported) {
        this.state.selectedView = "library";
        this.commit();
        closeModal();
        const warningText = warningCount ? `，另有 ${warningCount} 条重复内容提醒` : "";
        toast(
          `已导入 ${imported} 个来源：覆盖率 100%，${readableBlocks} 个正文块生成 ${generatedSegments} 个片段${warningText}`,
          warningCount ? "warning" : "success"
        );
      }
    }

    private async processPendingImportPackages(): Promise<void> {
      if (this.processingPendingImports || !DesktopBridge.isTauri()) return;
      this.processingPendingImports = true;
      try {
        const pending = await DesktopBridge.listPendingImportPackages();
        for (const item of pending) {
          try {
            if (item.error) throw new ImportPackageError("invalid_package", item.error);
            const result = importAgentPackage(item.json);
            if (this.state.books.some((book) => book.id === result.book.id)) {
              await DesktopBridge.acknowledgeImportPackage(item.id, true);
              continue;
            }
            const previous = deepClone(this.state);
            addImportedContent(this.state, result);
            this.state.selectedView = "library";
            if (!await this.commit()) {
              this.state = previous;
              this.render();
              break;
            }
            await DesktopBridge.acknowledgeImportPackage(item.id, true);
            toast(`Agent 已导入《${result.book.title}》：${result.segments.length} 段，覆盖率 100%`, "success");
          } catch (error) {
            const message = error instanceof Error ? error.message : "未知错误";
            await DesktopBridge.acknowledgeImportPackage(item.id, false, message);
            toast(`Agent 导入包已拒绝：${message}`, "warning");
          }
        }
      } catch (error) {
        console.warn("Failed to process Agent import inbox", error);
      } finally {
        this.processingPendingImports = false;
      }
    }

    private async continueBook(bookId: string): Promise<Segment | null> {
      const target = resumeSegmentForBook(this.state, bookId);
      if (!target) return null;
      const previous = deepClone(this.state);
      const previousBookId = currentBook(this.state)?.id;
      if (target) setCurrentSegment(this.state, target.id);
      if (!await this.commit(this.state, previousBookId !== bookId)) {
        this.state = previous;
        return null;
      }
      return target;
    }

    private openReader(segmentId?: string, immediate = false): void {
      if (isPopupMode() || isFloatingMode()) {
        void DesktopBridge.showMainWindow();
        return;
      }
      const segment = this.state.segments.find((item) => item.id === segmentId) || currentSegment(this.state);
      if (!segment) {
        this.activeReaderSegmentId = null;
        this.state.selectedView = "library";
        void this.commit();
        toast("书架是空的，请先导入阅读内容", "neutral");
        return;
      }
      this.activeReaderSegmentId = segment.id;
      const host = document.querySelector<HTMLElement>("#overlay-host") || document.body;
      host.querySelector(".reader-backdrop")?.remove();
      const template = document.createElement("template");
      template.innerHTML = renderReaderPanel(this.state, segment.id).trim();
      const panel = template.content.firstElementChild as HTMLElement;
      host.append(panel);
      if (immediate) panel.classList.add("visible");
      else requestAnimationFrame(() => panel.classList.add("visible"));
    }

    private async openReaderFromExternalRequest(segmentId: string): Promise<void> {
      if (isPopupMode() || isFloatingMode()) return;
      try {
        const persisted = await this.persistence.load();
        if (persisted) this.state = persisted;
      } catch (error) {
        console.warn("Failed to refresh state before opening reader", error);
      }
      const segment = this.state.segments.find((item) => item.id === segmentId);
      if (segment) setCurrentSegment(this.state, segment.id);
      this.activeReaderSegmentId = segment?.id || null;
      this.render();
      if (!segment) this.openReader(segmentId, true);
      await DesktopBridge.showMainWindow();
    }

    private async openHome(): Promise<boolean> {
      this.state.selectedView = "today";
      if (!await this.commit(this.state, !isPopupMode())) return false;
      if (isPopupMode()) {
        await DesktopBridge.requestOpenHome();
        await DesktopBridge.showMainWindow();
      }
      return true;
    }

    private replaceReader(segmentId?: string): void {
      const existing = document.querySelector<HTMLElement>(".reader-backdrop");
      if (!existing) {
        this.openReader(segmentId);
        return;
      }
      const template = document.createElement("template");
      template.innerHTML = renderReaderPanel(this.state, segmentId).trim();
      const next = template.content.firstElementChild as HTMLElement;
      existing.replaceWith(next);
      next.classList.add("visible");
    }

    private closeReader(event: MouseEvent, actionNode: HTMLElement): void {
      const clickedBackdrop = actionNode.classList.contains("reader-backdrop") && event.target === actionNode;
      const clickedButton = !actionNode.classList.contains("reader-backdrop");
      if (!clickedBackdrop && !clickedButton) return;
      this.activeReaderSegmentId = null;
      const backdrop = document.querySelector<HTMLElement>(".reader-backdrop");
      backdrop?.classList.remove("visible");
      window.setTimeout(() => backdrop?.remove(), 180);
      this.render();
    }

    private snooze(minutes: number): void {
      const until = new Date(Date.now() + minutes * 60_000);
      this.state.schedule.snoozeUntil = until.toISOString();
      addEvent(this.state, { type: "snoozed", segmentId: this.state.currentSegmentId, bookId: this.state.activeBookId, meta: { minutes } });
      this.commit();
      toast(`已延后到 ${formatTime(until)}`, "success");
    }

    private pauseToday(): void {
      this.state.schedule.pausedUntil = pauseUntilTomorrow();
      this.state.schedule.snoozeUntil = undefined;
      addEvent(this.state, { type: "snoozed", segmentId: this.state.currentSegmentId, bookId: this.state.activeBookId, meta: { minutes: "today" } });
      this.commit();
      toast("今天不再自动提醒，明天恢复", "success");
    }

    private exportFavorites(): void {
      const favoriteSegments = this.state.segments.filter((segment) => segment.favorite);
      const content = [
        `# ${BRAND.name}收藏与笔记`,
        "",
        `导出日期：${new Date().toLocaleString("zh-CN")}`,
        "",
        ...favoriteSegments.flatMap((segment) => {
          const book = this.state.books.find((item) => item.id === segment.bookId);
          return [
            `## ${book?.title || "未知来源"} · ${segment.chapterTitle}`,
            "",
            `**${segment.helperTitle}**`,
            "",
            `> ${segment.originalText.replace(/\n/g, "\n> ")}`,
            "",
            `来源位置：${segment.sourceAnchor.label}`,
            segment.note ? `\n我的笔记：${segment.note}` : "",
            "",
            "---",
            ""
          ];
        })
      ].join("\n");
      downloadText(`弹阅收藏-${localDateKey()}.md`, content, "text/markdown;charset=utf-8");
      toast("收藏已导出为 Markdown", "success");
    }

    private filterCards(hostSelector: string, query: string): void {
      const normalized = query.trim().toLowerCase();
      document.querySelectorAll<HTMLElement>(`${hostSelector} [data-search-text]`).forEach((card) => {
        card.hidden = Boolean(normalized) && !(card.dataset.searchText || "").includes(normalized);
      });
    }

    private applyLibrarySort(): void {
      const select = document.querySelector<HTMLSelectElement>("#library-sort");
      const grid = document.querySelector<HTMLElement>("#book-grid");
      if (!select || !grid) return;
      select.value = this.librarySortMode;
      const cards = new Map(
        Array.from(grid.querySelectorAll<HTMLElement>(".book-card[data-book-id]"))
          .map((card) => [card.dataset.bookId || "", card])
      );
      sortBooksForLibrary(this.state, this.librarySortMode).forEach((book) => {
        const card = cards.get(book.id);
        if (card) grid.append(card);
      });
    }

    private async setupDesktopListeners(): Promise<void> {
      this.unlistenState = await DesktopBridge.listenStateChanged(() => {
        void (async () => {
          const state = await this.persistence.load();
          if (!state) return;
          this.state = state;
          this.applyAppearance();
          if (isFloatingMode()) this.floating.refresh();
          else if (isPopupMode()) this.popup.refresh();
          else this.render();
        })();
      });
      this.unlistenAppearancePreview = await DesktopBridge.listenReadingAppearancePreview((fontScale) => {
        if (!isPopupMode()) return;
        this.state.settings.fontScale = fontScale;
        this.applyAppearance();
        this.popup.refit();
      });
      this.unlistenTray = await DesktopBridge.listenTrayActions((action) => {
        if (action === "read-now") void this.showPopup();
        if (action === "show-main") void DesktopBridge.showMainWindow();
        if (action === "pause-30") this.snooze(30);
        if (action === "pause-today") this.pauseToday();
      });
      this.unlistenOpenReader = await DesktopBridge.listenOpenReader((segmentId) => {
        void this.openReaderFromExternalRequest(segmentId);
      });
      this.unlistenOpenHome = await DesktopBridge.listenOpenHome(() => {
        if (isPopupMode() || isFloatingMode()) return;
        this.state.selectedView = "today";
        this.render();
      });
      window.addEventListener("beforeunload", () => {
        this.unlistenState?.();
        this.unlistenTray?.();
        this.unlistenOpenReader?.();
        this.unlistenOpenHome?.();
        this.unlistenAppearancePreview?.();
        if (this.pendingImportTimer !== null) window.clearInterval(this.pendingImportTimer);
      });
    }

    private startScheduler(): void {
      const tick = () => {
        if (!this.state.schedule.enabled || document.visibilityState === "hidden" && !DesktopBridge.isTauri()) return;
        const now = new Date();
        const slots = generateDailySlots(now, this.state.schedule);
        const due = slots.find((slot) => Math.abs(slot.at.getTime() - now.getTime()) < 30_000);
        if (!due || due.at.toISOString() === this.state.schedule.lastTriggeredSlot) return;
        const paused = this.state.schedule.pausedUntil && new Date(this.state.schedule.pausedUntil) > now;
        const snoozed = this.state.schedule.snoozeUntil && new Date(this.state.schedule.snoozeUntil) > now;
        if (paused || snoozed || isQuietTime(now, this.state.schedule)) return;
        this.state.schedule.lastTriggeredSlot = due.at.toISOString();
        void (async () => {
          if (await this.commit(this.state, false)) await this.showPopup(true);
        })();
      };
      tick();
      this.schedulerTimer = window.setInterval(tick, 15_000);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const app = new AppController();
    window.TanYueApp = app;
    void app.start();
  });
}
