namespace TanYue {
  type PopupStateCallback = (state: AppState) => Promise<boolean>;
  type OpenReaderCallback = (segmentId: string) => void;
  type OpenHomeCallback = () => Promise<boolean>;

  export class ReadingPopupController {
    private timerId: number | null = null;
    private remaining = 60;
    private duration = 60;
    private paused = false;
    private segmentId = "";
    private readonly popupMode: boolean;
    private pendingSave: Promise<boolean> | null = null;
    private dragged = false;
    private fitRevision = 0;
    private pendingDragPosition: { x: number; y: number } | null = null;
    private dragMoveInFlight = false;

    constructor(
      private readonly getState: () => AppState,
      private readonly onStateChange: PopupStateCallback,
      private readonly onOpenReader: OpenReaderCallback,
      private readonly onOpenHome: OpenHomeCallback,
      popupMode = false
    ) {
      this.popupMode = popupMode;
    }

    show(segmentId?: string): void {
      const state = this.getState();
      const segment = state.segments.find((item) => item.id === segmentId) || currentSegment(state);
      if (!segment) {
        this.segmentId = "";
        if (this.popupMode) void DesktopBridge.hideReadingPopup();
        return;
      }
      this.segmentId = segment.id;
      setCurrentSegment(state, segment.id);
      markShown(state, segment.id);
      this.duration = popupDisplaySeconds(segment, state.schedule);
      this.remaining = this.duration;
      this.pendingSave = this.onStateChange(state);
      this.mount();
      this.startTimer();
    }

    async close(advance = false): Promise<void> {
      this.stopTimer();
      await this.pendingSave;
      if (advance && this.segmentId) {
        const state = this.getState();
        dismissPopupAndAdvance(state, this.segmentId);
        await this.persist(state);
      }
      if (this.popupMode) {
        document.body.classList.add("popup-closing");
        void (async () => {
          await DesktopBridge.hideReadingPopup();
        })();
      } else {
        const host = document.querySelector<HTMLElement>("#reading-popup-layer");
        if (!host) return;
        host.classList.remove("visible");
        window.setTimeout(() => host.remove(), 180);
      }
    }

    destroy(): void {
      this.stopTimer();
      document.querySelector("#reading-popup-layer")?.remove();
    }

    refresh(): void {
      if (document.querySelector("#reading-popup-layer")) this.mount();
    }

    refit(): void {
      const host = document.querySelector<HTMLElement>("#reading-popup-layer");
      if (!host || !this.popupMode) return;
      requestAnimationFrame(() => void this.fitToContent(host));
    }

    private current(): { state: AppState; segment: Segment; book: Book } | null {
      const state = this.getState();
      const segment = state.segments.find((item) => item.id === this.segmentId) || currentSegment(state);
      if (!segment) return null;
      const book = state.books.find((item) => item.id === segment.bookId) || currentBook(state);
      if (!book) return null;
      return { state, segment, book };
    }

    private mount(): void {
      const current = this.current();
      if (!current) {
        void this.close();
        return;
      }
      const { state, segment, book } = current;
      document.body.classList.toggle("popup-window", this.popupMode);
      document.body.classList.remove("popup-closing");

      let host = document.querySelector<HTMLElement>("#reading-popup-layer");
      if (!host) {
        host = document.createElement("div");
        host.id = "reading-popup-layer";
        host.className = this.popupMode ? "reading-popup-layer popup-standalone" : "reading-popup-layer";
        (this.popupMode ? document.body : document.querySelector("#overlay-host") || document.body).append(host);
      }
      host.innerHTML = this.render(state, segment, book);
      this.bind(host);
      requestAnimationFrame(() => {
        host?.classList.add("visible");
        if (host && this.popupMode) void this.fitToContent(host);
      });
    }

    private render(state: AppState, segment: Segment, book: Book): string {
      const percentage = countdownProgressPercent(this.remaining, this.duration);
      const sequenceLabel = `${segment.sequence} / ${Math.max(1, book.segmentCount)}`;
      const hasNext = Boolean(nextSegment(state, segment.id));
      const readingHeading = readingHeadingForSegment(state, segment);
      const sourceLine = readingHeading
        ? `《${escapeHtml(book.title)}》`
        : `《${escapeHtml(book.title)}》 · ${escapeHtml(segment.chapterTitle)}`;
      return `
        <div class="popup-click-catcher" data-popup-action="close"></div>
        <article class="reading-popup-card popup-size-${state.settings.popupSizeMode}${state.settings.adSkin ? " popup-ad-skin" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(book.title)}阅读片段">
          <span class="popup-drag-edge popup-drag-edge-top" data-popup-drag-handle aria-hidden="true"></span>
          <span class="popup-drag-edge popup-drag-edge-right" data-popup-drag-handle aria-hidden="true"></span>
          <span class="popup-drag-edge popup-drag-edge-bottom" data-popup-drag-handle aria-hidden="true"></span>
          <span class="popup-drag-edge popup-drag-edge-left" data-popup-drag-handle aria-hidden="true"></span>
          <header class="popup-app-header" data-popup-drag-handle>
            <span class="popup-titlebar-drag-region" data-popup-drag-handle aria-hidden="true"></span>
            <div class="popup-app-identity" data-popup-drag-handle title="拖动阅读卡片">
              <span class="popup-app-logo" data-popup-drag-handle><span class="brand-glyph"><i></i><i></i><b></b></span></span>
              <div><strong>${state.settings.adSkin ? "精选推荐 · 广告" : BRAND.name}</strong><small>${state.settings.adSkin ? "给生活一点新灵感" : BRAND.tagline}</small></div>
            </div>
            <div class="popup-app-actions">
              <button class="popup-icon-button" data-popup-action="open-home" aria-label="打开弹阅首页" title="打开弹阅首页">${icon("external", 15)}</button>
              <button class="popup-icon-button" data-popup-action="close" aria-label="关闭">${icon("close", 16)}</button>
            </div>
          </header>

          <section class="popup-reading-body">
            <div class="popup-reading-content">
              <div class="popup-chapter-line">
                <span>${sourceLine}</span>
                <div class="popup-chapter-tools">
                  <button class="popup-favorite-button ${segment.favorite ? "active" : ""}" data-popup-action="favorite" aria-label="${segment.favorite ? "取消收藏" : "收藏这一段"}" aria-pressed="${segment.favorite}" title="${segment.favorite ? "取消收藏" : "收藏这一段"}">${icon("heart", 12)}</button>
                  <span class="popup-sequence-label">${sequenceLabel}</span>
                </div>
              </div>
              ${readingHeading ? `<h1>${escapeHtml(readingHeading)}</h1>` : ""}
              <div class="popup-original ${state.settings.readingFont === "sans" ? "font-sans" : ""}">${segment.originalText.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
              ${state.settings.showExplanation && segment.explanation ? `
                <details class="popup-explanation">
                  <summary>${icon("sparkles", 16)}一句话理解 ${icon("chevronRight", 15)}</summary>
                  <p>${escapeHtml(segment.explanation)}</p>
                </details>` : ""}
            </div>
          </section>

          <footer class="popup-footer">
            <div class="popup-timer-summary">
              <span>${readingTimeLabel(segment)}读完</span>
              <div class="popup-timer-track"><span id="popup-timer-fill" style="transform:scaleX(${percentage / 100})"></span></div>
              <span><b id="popup-seconds">${this.remaining}</b> 秒后收起</span>
            </div>
            <div class="popup-action-grid">
              <button data-popup-action="open-reader">${icon("play", 15)}<span>继续阅读</span></button>
              <button class="popup-next" data-popup-action="continue">${icon(hasNext ? "arrowRight" : "check", 15)}<span>${hasNext ? "读完下一段" : "完成本书"}</span></button>
              <button data-popup-action="snooze">${icon("clock", 15)}<span>稍后提醒</span></button>
              <button data-popup-action="pause-today">${icon("pause", 15)}<span>今天暂停</span></button>
            </div>
          </footer>
        </article>`;
    }

    private bind(host: HTMLElement): void {
      host.querySelectorAll<HTMLElement>("[data-popup-action]").forEach((node) => {
        node.addEventListener("click", (event) => {
          event.stopPropagation();
          const action = node.dataset.popupAction;
          if (action) void this.handle(action);
        });
      });

      const card = host.querySelector<HTMLElement>(".reading-popup-card");
      if (card) {
        card.addEventListener("mouseenter", () => {
          if (this.getState().settings.hoverPausesTimer) this.paused = true;
        });
        card.addEventListener("mouseleave", () => {
          this.paused = false;
        });
        card.addEventListener("focusin", () => {
          if (this.getState().settings.hoverPausesTimer) this.paused = true;
        });
        card.addEventListener("focusout", (event) => {
          if (!card.contains(event.relatedTarget as Node | null) && !card.matches(":hover")) this.paused = false;
        });
      }

      if (this.popupMode) {
        host.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          const handle = target?.closest<HTMLElement>("[data-popup-drag-handle]");
          if (!handle || target?.closest("[data-popup-action]")) return;
          event.preventDefault();
          this.dragged = true;
          const pointerId = event.pointerId;
          const pointerStartX = event.screenX;
          const pointerStartY = event.screenY;
          const windowStartX = window.screenX;
          const windowStartY = window.screenY;
          handle.setPointerCapture(pointerId);

          const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            this.queuePopupMove(
              windowStartX + moveEvent.screenX - pointerStartX,
              windowStartY + moveEvent.screenY - pointerStartY
            );
          };
          const finish = (finishEvent: PointerEvent) => {
            if (finishEvent.pointerId !== pointerId) return;
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", finish);
            handle.removeEventListener("pointercancel", finish);
            if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", finish);
          handle.addEventListener("pointercancel", finish);
        });

        host.querySelector(".popup-explanation")?.addEventListener("toggle", () => {
          requestAnimationFrame(() => void this.fitToContent(host));
        });
      }
    }

    private queuePopupMove(x: number, y: number): void {
      this.pendingDragPosition = { x, y };
      if (!this.dragMoveInFlight) void this.flushPopupMove();
    }

    private async flushPopupMove(): Promise<void> {
      this.dragMoveInFlight = true;
      while (this.pendingDragPosition) {
        const position = this.pendingDragPosition;
        this.pendingDragPosition = null;
        await DesktopBridge.moveReadingPopup(position.x, position.y);
      }
      this.dragMoveInFlight = false;
    }

    private async fitToContent(host: HTMLElement): Promise<void> {
      const revision = ++this.fitRevision;
      const current = this.current();
      if (!current) return;
      const { state, segment } = current;
      const sizeMode = state.settings.popupSizeMode;
      const width = popupWidthForText(segment.originalText, sizeMode, state.settings.fontScale);
      const provisionalHeight = popupHeightForContent(window.innerHeight, window.screen.availHeight, sizeMode);
      await DesktopBridge.fitReadingPopup(width, provisionalHeight, !this.dragged);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (revision !== this.fitRevision || !host.isConnected) return;

      const header = host.querySelector<HTMLElement>(".popup-app-header");
      const body = host.querySelector<HTMLElement>(".popup-reading-body");
      const content = host.querySelector<HTMLElement>(".popup-reading-content");
      const footer = host.querySelector<HTMLElement>(".popup-footer");
      if (!header || !body || !content || !footer) return;

      const bodyStyle = getComputedStyle(body);
      const verticalPadding = Number.parseFloat(bodyStyle.paddingTop) + Number.parseFloat(bodyStyle.paddingBottom);
      const naturalHeight = header.offsetHeight + content.scrollHeight + verticalPadding + footer.offsetHeight + 2;
      const height = popupHeightForContent(naturalHeight, window.screen.availHeight, sizeMode);
      await DesktopBridge.fitReadingPopup(width, height, !this.dragged, true);
    }

    private async handle(action: string): Promise<void> {
      const current = this.current();
      if (!current) {
        await this.close();
        return;
      }
      const { state, segment, book } = current;
      if (action === "close") {
        await this.close(true);
        return;
      }
      if (action === "open-home") {
        if (!await this.onOpenHome()) return;
        await this.close();
        return;
      }
      if (action === "snooze") {
        const until = new Date(Date.now() + 30 * 60_000);
        state.schedule.snoozeUntil = until.toISOString();
        addEvent(state, { type: "snoozed", segmentId: segment.id, bookId: segment.bookId, meta: { minutes: 30 } });
        if (!await this.persist(state)) return;
        await this.close();
        if (!this.popupMode) toast(`已延后到 ${formatTime(until)}`, "success");
        return;
      }
      if (action === "continue") {
        markConfirmed(state, segment.id);
        const next = nextSegment(state, segment.id);
        if (!next) {
          const nextUnread = firstUnreadSegment(state, state.activeBookId, segment.bookId);
          if (nextUnread) setCurrentSegment(state, nextUnread.id);
          if (!await this.persist(state)) return;
          await this.close();
          if (!this.popupMode) toast(bookCompletionMessage(state, book), "success");
          return;
        }
        setCurrentSegment(state, next.id);
        markShown(state, next.id);
        this.segmentId = next.id;
        this.duration = popupDisplaySeconds(next, state.schedule);
        this.remaining = this.duration;
        this.paused = false;
        if (!await this.persist(state)) return;
        this.mount();
        this.startTimer();
        return;
      }
      if (action === "pause-today") {
        state.schedule.pausedUntil = pauseUntilTomorrow();
        state.schedule.snoozeUntil = undefined;
        addEvent(state, { type: "snoozed", segmentId: segment.id, bookId: segment.bookId, meta: { minutes: "today" } });
        if (!await this.persist(state)) return;
        await this.close();
        if (!this.popupMode) toast("今天不再自动提醒，明天恢复", "success");
        return;
      }
      if (action === "favorite") {
        const active = toggleFavorite(state, segment.id);
        if (!await this.persist(state)) return;
        const button = document.querySelector<HTMLButtonElement>('[data-popup-action="favorite"]');
        if (button) {
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
          button.setAttribute("aria-label", active ? "取消收藏" : "收藏这一段");
          button.title = active ? "取消收藏" : "收藏这一段";
        }
        return;
      }
      if (action === "open-reader") {
        if (!await this.persist(state)) return;
        if (this.popupMode) {
          await DesktopBridge.requestOpenReader(segment.id);
          await this.close();
          return;
        }
        await this.close();
        this.onOpenReader(segment.id);
      }
    }

    private startTimer(): void {
      this.stopTimer();
      this.timerId = window.setInterval(() => {
        if (this.paused) return;
        this.remaining -= 1;
        this.updateTimerUi();
        if (this.remaining <= 0) void this.close(true);
      }, 1000);
    }

    private stopTimer(): void {
      if (this.timerId !== null) window.clearInterval(this.timerId);
      this.timerId = null;
    }

    private updateTimerUi(): void {
      const current = this.current();
      if (!current) return;
      const seconds = document.querySelector<HTMLElement>("#popup-seconds");
      const fill = document.querySelector<HTMLElement>("#popup-timer-fill");
      if (seconds) seconds.textContent = String(Math.max(0, this.remaining));
      if (fill) fill.style.transform = `scaleX(${countdownProgressPercent(this.remaining, this.duration) / 100})`;
    }

    private async persist(state: AppState): Promise<boolean> {
      const pending = this.onStateChange(state);
      this.pendingSave = pending;
      const saved = await pending;
      if (this.pendingSave === pending) this.pendingSave = null;
      return saved;
    }
  }
}
