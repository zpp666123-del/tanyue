namespace TanYue {
  export function bookCover(book: Book, compact = false): string {
    const titleLines = bookCoverTitleLines(book.title);
    const longestLine = Math.max(...titleLines.map((line) => Array.from(line).length));
    const titleSize = longestLine <= 3 ? "short" : longestLine === 4 ? "medium" : "long";
    return `
      <div class="book-cover cover-${book.coverStyle} ${compact ? "book-cover-compact" : ""}" style="--book-accent:${escapeHtml(book.accent)}">
        <div class="book-cover-grain"></div>
        <span class="book-cover-kicker">${book.kind === "classic" ? "经典" : book.kind === "article" ? "文章" : "文档"}</span>
        <strong class="book-cover-title book-cover-title-${titleSize}" aria-hidden="true">${titleLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</strong>
        <small>${escapeHtml(book.author || "未署名")}</small>
      </div>`;
  }

  export function progressBar(percent: number, label?: string): string {
    return `
      <div class="progress-wrap" aria-label="${escapeHtml(label || `进度 ${percent}%`)}">
        <div class="progress-track"><span style="width:${clamp(percent, 0, 100)}%"></span></div>
        ${label ? `<small>${escapeHtml(label)}</small>` : ""}
      </div>`;
  }

  export function statusPill(label: string, tone: "good" | "warm" | "muted" | "info" = "muted"): string {
    return `<span class="status-pill status-${tone}">${escapeHtml(label)}</span>`;
  }

  export function toggleControl(id: string, checked: boolean, label: string, description?: string): string {
    return `
      <label class="setting-row" for="${escapeHtml(id)}">
        <span class="setting-copy">
          <strong>${escapeHtml(label)}</strong>
          ${description ? `<small>${escapeHtml(description)}</small>` : ""}
        </span>
        <span class="switch">
          <input id="${escapeHtml(id)}" type="checkbox" data-setting="${escapeHtml(id)}" ${checked ? "checked" : ""}>
          <span class="switch-track"><span></span></span>
        </span>
      </label>`;
  }

  export function emptyState(iconName: string, title: string, description: string, action?: string): string {
    return `
      <div class="empty-state">
        <div class="empty-icon">${icon(iconName, 28)}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        ${action || ""}
      </div>`;
  }

  export function statCard(iconName: string, label: string, value: string, hint: string, tone = "paper"): string {
    return `
      <article class="stat-card stat-${tone}">
        <div class="stat-icon">${icon(iconName, 19)}</div>
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></div>
      </article>`;
  }

  export function segmentStatusLabel(segment: Segment): string {
    if (segment.status === "confirmed") return "已读";
    if (segment.status === "shown") return "已展示";
    return "未读";
  }

  export function segmentListItem(segment: Segment, active = false, resumeTarget = false, choosePosition = false): string {
    return `
      <button class="segment-list-item ${active ? "active" : ""}" data-action="open-segment" data-segment-id="${segment.id}" data-search-text="${escapeHtml(`${segment.sequence} ${segment.chapterTitle} ${segment.helperTitle}`.toLowerCase())}" aria-label="从第 ${segment.sequence} 段 ${escapeHtml(segment.chapterTitle)} 开始阅读">
        <span class="segment-index">${pad2(segment.sequence)}</span>
        <span class="segment-list-copy">
          <strong>${escapeHtml(segment.chapterTitle)}</strong>
          <small>${escapeHtml(segment.helperTitle)}</small>
        </span>
        <span class="segment-list-meta">
          ${resumeTarget ? '<em class="segment-resume-pill">接续位置</em>' : ""}
          ${segment.favorite ? icon("heart", 16, "heart-filled") : ""}
          <small>${segment.estimatedSeconds}s</small>
          ${choosePosition ? '<em class="segment-choice-label">读这一段</em>' : icon("chevronRight", 16)}
        </span>
      </button>`;
  }

  export function toast(message: string, tone: "success" | "warning" | "neutral" = "neutral"): void {
    const compact = document.body.classList.contains("popup-window");
    let host = document.querySelector<HTMLDivElement>("#toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.append(host);
    }
    if (compact) host.replaceChildren();
    const node = document.createElement("div");
    node.className = `toast toast-${tone}${compact ? " toast-compact" : ""}`;
    node.innerHTML = `${icon(tone === "success" ? "check" : tone === "warning" ? "bell" : "sparkles", compact ? 13 : 18)}<span>${escapeHtml(message)}</span>`;
    host.append(node);
    requestAnimationFrame(() => node.classList.add("show"));
    window.setTimeout(() => {
      node.classList.remove("show");
      window.setTimeout(() => node.remove(), compact ? 140 : 220);
    }, compact ? 1500 : 3200);
  }

  export function modalShell(id: string, title: string, subtitle: string, content: string, wide = false): string {
    return `
      <div class="modal-backdrop" data-action="close-modal" data-modal-id="${id}">
        <section class="modal ${wide ? "modal-wide" : ""}" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
          <header class="modal-header">
            <div><h2 id="${id}-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
            <button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("close", 20)}</button>
          </header>
          <div class="modal-body">${content}</div>
        </section>
      </div>`;
  }

  export function appendModal(html: string): HTMLElement {
    document.querySelector(".modal-backdrop")?.remove();
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    const node = template.content.firstElementChild as HTMLElement;
    document.body.append(node);
    const previousFocus = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      node.classList.add("visible");
      node.querySelector<HTMLElement>("button, input, summary")?.focus();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]), summary, [tabindex="0"]')).filter((item) => item.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    node.addEventListener("transitionend", () => {
      if (!node.classList.contains("visible") && previousFocus?.isConnected) previousFocus.focus();
    });
    return node;
  }

  export function closeModal(): void {
    const node = document.querySelector<HTMLElement>(".modal-backdrop");
    if (!node) return;
    node.classList.remove("visible");
    window.setTimeout(() => node.remove(), 180);
  }

  export function readingTimeLabel(segment: Segment): string {
    return `约 ${segment.estimatedSeconds} 秒`;
  }
}
