namespace TanYue {
  const FLOATING_POSITION_KEY = "tanyue.floating.position.v1";

  interface FloatingPosition {
    left: number;
    top: number;
  }

  export class FloatingWidgetController {
    private moved = false;
    private standalone = false;

    constructor(
      private readonly getState: () => AppState,
      private readonly onOpen: () => Promise<void> | void
    ) {}

    mountStandalone(): void {
      this.standalone = true;
      document.documentElement.classList.add("floating-html");
      document.body.className = "floating-window";
      document.body.innerHTML = this.render(true);
      const shell = document.querySelector<HTMLElement>("#floating-widget-shell");
      if (shell) this.bind(shell, true);
    }

    mountOverlay(enabled: boolean): void {
      if (this.standalone || DesktopBridge.isTauri()) return;
      const existing = document.querySelector<HTMLElement>("#floating-widget-shell");
      if (!enabled) {
        existing?.remove();
        return;
      }

      const template = document.createElement("template");
      template.innerHTML = this.render(false).trim();
      const next = template.content.firstElementChild as HTMLElement;
      if (existing) existing.replaceWith(next);
      else document.body.append(next);
      this.applySavedPosition(next);
      this.bind(next, false);
    }

    refresh(): void {
      if (this.standalone) this.mountStandalone();
      else this.mountOverlay(this.getState().settings.floatingWidget);
    }

    private render(standalone: boolean): string {
      const state = this.getState();
      const segment = currentSegment(state);
      const title = segment ? `${segment.chapterTitle} · ${segment.helperTitle}` : "书架为空，点击导入内容";
      return `
        <div id="floating-widget-shell" class="floating-widget-shell ${standalone ? "standalone" : "browser-overlay"}">
          ${standalone ? '<div class="floating-drag-strip" data-tauri-drag-region title="拖动悬浮图标"></div>' : ""}
          <button class="floating-orb" type="button" aria-label="${segment ? "打开弹阅阅读卡片" : "打开弹阅并导入内容"}" title="${escapeHtml(title)}">
            <span class="floating-logo" aria-hidden="true"><i></i><i></i><b></b></span>
          </button>
          ${standalone ? "" : `<span class="floating-tooltip"><strong>${BRAND.name}</strong><small>${segment ? `${escapeHtml(segment.chapterTitle)} · ${segment.estimatedSeconds} 秒` : "书架为空"}</small></span>`}
        </div>`;
    }

    private bind(shell: HTMLElement, standalone: boolean): void {
      const orb = shell.querySelector<HTMLButtonElement>(".floating-orb");
      if (!orb) return;

      if (standalone) {
        let pointerId = -1;
        let startX = 0;
        let startY = 0;
        let dragging = false;

        orb.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          pointerId = event.pointerId;
          startX = event.clientX;
          startY = event.clientY;
          dragging = false;
          orb.setPointerCapture(pointerId);
        });
        orb.addEventListener("pointermove", (event) => {
          if (event.pointerId !== pointerId || dragging) return;
          if (Math.hypot(event.clientX - startX, event.clientY - startY) <= 4) return;
          dragging = true;
          shell.classList.add("dragging");
          void DesktopBridge.startFloatingWidgetDrag();
        });
        const finishStandalone = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          if (orb.hasPointerCapture(pointerId)) orb.releasePointerCapture(pointerId);
          shell.classList.remove("dragging");
          pointerId = -1;
          if (!dragging) void this.onOpen();
        };
        orb.addEventListener("pointerup", finishStandalone);
        orb.addEventListener("pointercancel", finishStandalone);
        orb.addEventListener("click", (event) => event.preventDefault());
        return;
      }

      let pointerId = -1;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      orb.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        const rect = shell.getBoundingClientRect();
        originLeft = rect.left;
        originTop = rect.top;
        this.moved = false;
        orb.setPointerCapture(pointerId);
        shell.classList.add("dragging");
      });

      orb.addEventListener("pointermove", (event) => {
        if (event.pointerId !== pointerId || !orb.hasPointerCapture(pointerId)) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.hypot(dx, dy) > 5) this.moved = true;
        const maxLeft = Math.max(12, window.innerWidth - shell.offsetWidth - 12);
        const maxTop = Math.max(12, window.innerHeight - shell.offsetHeight - 12);
        shell.style.left = `${clamp(originLeft + dx, 12, maxLeft)}px`;
        shell.style.top = `${clamp(originTop + dy, 12, maxTop)}px`;
        shell.style.right = "auto";
        shell.style.bottom = "auto";
      });

      const finish = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        if (orb.hasPointerCapture(pointerId)) orb.releasePointerCapture(pointerId);
        shell.classList.remove("dragging");
        pointerId = -1;
        if (this.moved) this.savePosition(shell);
        else void this.onOpen();
      };

      orb.addEventListener("pointerup", finish);
      orb.addEventListener("pointercancel", finish);
      orb.addEventListener("click", (event) => event.preventDefault());
    }

    private applySavedPosition(shell: HTMLElement): void {
      try {
        const raw = window.localStorage.getItem(FLOATING_POSITION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as FloatingPosition;
        const maxLeft = Math.max(12, window.innerWidth - shell.offsetWidth - 12);
        const maxTop = Math.max(12, window.innerHeight - shell.offsetHeight - 12);
        shell.style.left = `${clamp(saved.left, 12, maxLeft)}px`;
        shell.style.top = `${clamp(saved.top, 12, maxTop)}px`;
        shell.style.right = "auto";
        shell.style.bottom = "auto";
      } catch {
        window.localStorage.removeItem(FLOATING_POSITION_KEY);
      }
    }

    private savePosition(shell: HTMLElement): void {
      const rect = shell.getBoundingClientRect();
      window.localStorage.setItem(FLOATING_POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top } satisfies FloatingPosition));
    }
  }
}
