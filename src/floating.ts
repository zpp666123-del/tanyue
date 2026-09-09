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
      if (!this.standalone) this.mountOverlay(this.getState().settings.floatingWidget);
    }

    private render(standalone: boolean): string {
      const state = this.getState();
      const segment = currentSegment(state);
      return `
        <div id="floating-widget-shell" class="floating-widget-shell ${standalone ? "standalone" : "browser-overlay"}">
          <button class="floating-orb" type="button" aria-label="打开弹阅阅读卡片">
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
        let originX = 0;
        let originY = 0;
        let pending: { x: number; y: number; settle: boolean } | null = null;
        let sending = false;
        const move = async (event: PointerEvent, settle: boolean) => {
          pending = { x: originX + event.screenX - startX, y: originY + event.screenY - startY, settle };
          if (sending) return;
          sending = true;
          try {
            while (pending) {
              const position = pending;
              pending = null;
              await DesktopBridge.moveFloatingWidget(position.x, position.y, position.settle);
            }
          } finally { sending = false; }
        };

        orb.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          pointerId = event.pointerId;
          startX = event.screenX;
          startY = event.screenY;
          originX = window.screenX;
          originY = window.screenY;
          dragging = false;
          orb.setPointerCapture(pointerId);
        });
        orb.addEventListener("pointermove", (event) => {
          if (event.pointerId !== pointerId) return;
          if (!dragging && Math.hypot(event.screenX - startX, event.screenY - startY) <= 4) return;
          dragging = true;
          shell.classList.add("dragging");
          void move(event, false);
        });
        const finishStandalone = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          if (orb.hasPointerCapture(pointerId)) orb.releasePointerCapture(pointerId);
          shell.classList.remove("dragging");
          pointerId = -1;
          if (dragging) void move(event, true);
          if (!dragging && event.type === "pointerup") void this.onOpen();
        };
        orb.addEventListener("pointerup", finishStandalone);
        orb.addEventListener("pointercancel", finishStandalone);
        orb.addEventListener("click", (event) => {
          event.preventDefault();
          if (event.detail === 0) void this.onOpen();
        });
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
        const maxLeft = Math.max(0, window.innerWidth - shell.offsetWidth);
        const maxTop = Math.max(12, window.innerHeight - shell.offsetHeight - 12);
        shell.style.left = `${clamp(originLeft + dx, 0, maxLeft)}px`;
        shell.style.top = `${clamp(originTop + dy, 12, maxTop)}px`;
        shell.style.right = "auto";
        shell.style.bottom = "auto";
      });

      const finish = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        if (orb.hasPointerCapture(pointerId)) orb.releasePointerCapture(pointerId);
        shell.classList.remove("dragging");
        pointerId = -1;
        if (this.moved) {
          const rect = shell.getBoundingClientRect();
          if (rect.left <= 24) shell.style.left = `${-rect.width / 2}px`;
          else if (rect.right >= window.innerWidth - 24) shell.style.left = `${window.innerWidth - rect.width / 2}px`;
          this.savePosition(shell);
        } else if (event.type === "pointerup") void this.onOpen();
      };

      orb.addEventListener("pointerup", finish);
      orb.addEventListener("pointercancel", finish);
      orb.addEventListener("click", (event) => {
        event.preventDefault();
        if (event.detail === 0) void this.onOpen();
      });
    }

    private applySavedPosition(shell: HTMLElement): void {
      try {
        const raw = window.localStorage.getItem(FLOATING_POSITION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as FloatingPosition;
        if (!Number.isFinite(saved.left) || !Number.isFinite(saved.top)) throw new Error("Invalid position");
        const maxLeft = window.innerWidth - shell.offsetWidth / 2;
        const maxTop = Math.max(12, window.innerHeight - shell.offsetHeight - 12);
        shell.style.left = `${clamp(saved.left, -shell.offsetWidth / 2, maxLeft)}px`;
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
