namespace TanYue {
  const NAV_ITEMS: Array<{ id: ViewId; label: string; iconName: string }> = [
    { id: "today", label: "今日", iconName: "home" },
    { id: "library", label: "书架", iconName: "library" },
    { id: "plan", label: "阅读计划", iconName: "calendar" },
    { id: "favorites", label: "收藏", iconName: "heart" },
    { id: "settings", label: "设置", iconName: "settings" }
  ];

  function brandGlyph(extraClass = ""): string {
    return `<span class="brand-glyph ${extraClass}" aria-hidden="true"><i></i><i></i><b></b></span>`;
  }

  export function renderAppShell(state: AppState, update: UpdateUiState): string {
    const selected = state.selectedView;
    const current = currentSegment(state);
    const activeBook = currentBook(state);
    const favoriteCount = state.segments.filter((segment) => segment.favorite).length;
    return `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand-block">
            <div class="brand-mark">${brandGlyph()}</div>
            <div><strong>${BRAND.name}</strong><small>阅读，让思考更有回响</small></div>
          </div>
          <nav class="main-nav" aria-label="主导航">
            ${NAV_ITEMS.map((item) => `
              <button class="nav-item ${selected === item.id ? "active" : ""}" data-action="navigate" data-view="${item.id}">
                ${icon(item.iconName, 19)}
                <span>${item.label}</span>
                ${item.id === "favorites" && favoriteCount ? `<em>${favoriteCount}</em>` : ""}
              </button>`).join("")}
          </nav>
          <div class="sidebar-spacer"></div>
          <blockquote class="sidebar-quote">
            <i></i>
            <p>${current ? escapeHtml(firstSentence(current.originalText, 48)) : "书架还没有内容，先导入一本书或文档。"}</p>
            <cite>${current && activeBook ? `— 《${escapeHtml(activeBook.title)}》 · ${escapeHtml(current.chapterTitle)}` : "内容默认保存在本机"}</cite>
          </blockquote>
          <button class="sidebar-read-button" data-action="${current ? "show-reading-popup" : "open-import"}">${icon(current ? "play" : "plus", 15)}${current ? "读一段" : "导入内容"}</button>
          <span class="sidebar-local-state">${DesktopBridge.isTauri() ? "桌面模式" : "浏览器预览"} · 本地优先</span>
        </aside>
        <main class="main-area">
          ${renderTopbar(state)}
          <section class="view-host" id="view-host">${renderView(state, update)}</section>
        </main>
      </div>
      <div id="overlay-host"></div>
      <div id="toast-host"></div>`;
  }

  function renderTopbar(state: AppState): string {
    const next = computeNextDue(state.schedule);
    const pause = activeReminderPause(state.schedule);
    return `
      <header class="topbar">
        <div class="topbar-brand-line">
          <span>${pause ? `${pause.kind === "today" ? "今天已暂停" : "已延后"} · ${formatTime(pause.until)} 恢复` : state.schedule.enabled ? `下一段 ${next ? formatTime(next) : "待安排"}` : "阅读计划已暂停"}</span>
        </div>
        <div class="topbar-actions">
          <button class="top-search" data-action="focus-search" aria-label="搜索书籍或片段">${icon("search", 16)}<span>搜索书籍或片段</span><kbd>Ctrl K</kbd></button>
          <button class="icon-button topbar-icon" data-action="toggle-theme" aria-label="切换主题">${icon(state.settings.theme === "dark" ? "sun" : "moon", 18)}</button>
          <button class="primary-button compact" data-action="open-import">${icon("plus", 16)}导入</button>
        </div>
      </header>`;
  }

  export function renderView(state: AppState, update: UpdateUiState): string {
    switch (state.selectedView) {
      case "library": return renderLibraryView(state);
      case "plan": return renderPlanView(state);
      case "favorites": return renderFavoritesView(state);
      case "settings": return renderSettingsView(state, update);
      case "today":
      default: return renderTodayView(state);
    }
  }

  function renderContinueBookCard(state: AppState, book: Book, currentBookId: string): string {
    const progress = progressForBook(state, book.id);
    const next = resumeSegmentForBook(state, book.id);
    return `
      <article class="continue-book-card ${book.id === currentBookId ? "current" : ""}" data-search-text="${escapeHtml(`${book.title} ${book.author}`.toLowerCase())}">
        <button class="continue-book-cover" data-action="continue-book" data-book-id="${book.id}" aria-label="继续阅读 ${escapeHtml(book.title)}">${bookCover(book, true)}</button>
        <div class="continue-book-copy">
          ${book.id === currentBookId ? '<span class="current-book-badge">正在读</span>' : ""}
          <h3 title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</h3>
          <p>${escapeHtml(book.author || "未署名")}</p>
          <div class="continue-progress-copy"><span>确认读完 ${progress.read} / ${progress.total} 段 · 浏览 ${progress.browsed} 段</span><b>${progress.percent}%</b></div>
          ${progressBar(progress.percent)}
          <button class="continue-inline" data-action="continue-book" data-book-id="${book.id}">${icon("play", 12)}${progress.percent === 100 ? "重新阅读" : next ? `继续第 ${next.sequence} 段` : "继续阅读"}${next ? `<small>${escapeHtml(next.chapterTitle)}</small>` : ""}</button>
        </div>
      </article>`;
  }

  function renderTodayView(state: AppState): string {
    const summary = dailySummary(state);
    const current = currentSegment(state);
    const activeBook = currentBook(state);
    const pause = activeReminderPause(state.schedule);
    const books = booksForContinueReading(state, 1);
    const slots = getUpcomingSlots(state.schedule, new Date(), 3);
    const dailyPercent = Math.min(100, Math.round((summary.confirmed / Math.max(1, state.schedule.dailyCount)) * 100));

    return `
      <div class="page page-today minimal-today">
        <header class="minimal-hero">
          <div class="minimal-hero-copy">
            <span class="hero-date">${formatDate(new Date())}</span>
            <small>享受一段专注的阅读时光。</small>
            <h1>少而精地读，深而静地思。</h1>
            <p>每天进步一点点，日积月累，自有收获。</p>
          </div>
          <article class="today-summary-card">
            <span>今日阅读</span>
            <div class="today-summary-metrics">
              <div title="按确认读完的片段估算，不是实际计时">${icon("clock", 19)}<strong>${Math.max(summary.minutes, 0)}</strong><small>分钟（预计）</small></div>
              <div>${icon("note", 19)}<strong>${summary.confirmed}</strong><small>段</small></div>
              <div>${icon("heart", 19)}<strong>${summary.favorites}</strong><small>条</small></div>
            </div>
          </article>
        </header>

        <section class="minimal-section continue-section">
          <header class="minimal-section-header"><div>${activeBook && current
            ? `<span class="current-reading-label"><em>正在读</em><b title="${escapeHtml(activeBook.title)}">《${escapeHtml(activeBook.title)}》</b></span><small>${escapeHtml(current.chapterTitle)} · 第 ${current.sequence} / ${Math.max(1, activeBook.segmentCount)} 段</small>`
            : "<span>继续阅读</span><small>从上次停下的地方继续</small>"}</div><button data-action="navigate" data-view="library">查看全部 ${icon("chevronRight", 14)}</button></header>
          <div class="continue-books-grid single-current-book">${books.length
            ? books.map((book) => renderContinueBookCard(state, book, activeBook?.id || "")).join("")
            : emptyState("library", "书架还是空的", "导入内容后，阅读进度会在这里自动接续。", `<button class="primary-button" data-action="open-import">${icon("plus", 16)}导入内容</button>`)}</div>
        </section>

        <section class="minimal-lower-grid">
          <article class="apple-card reading-plan-card">
            <header><div><span>阅读计划</span><small>保持轻量，才容易坚持</small></div><button data-action="navigate" data-view="plan">编辑计划</button></header>
            <div class="plan-progress-title"><strong>每日精读 · ${state.schedule.dailyCount} 段</strong><span>${summary.confirmed} / ${state.schedule.dailyCount} 段</span></div>
            <div class="apple-progress"><span style="width:${dailyPercent}%"></span></div>
            <p>累计确认读完 ${state.segments.filter((item) => item.status === "confirmed").length} 段 · 按自己的节奏阅读</p>
          </article>

          <article class="apple-card today-plan-card">
            <header><div><span>今日计划</span><small>${pause ? (pause.kind === "today" ? "今天已暂停" : `已延后至 ${formatTime(pause.until)}`) : state.schedule.enabled ? "按节奏出现，不抢工作焦点" : "当前已暂停"}</small></div><button data-action="navigate" data-view="plan">管理</button></header>
            <div class="timeline-list">
              ${current && slots.length ? slots.map((slot, index) => `
                <div class="timeline-item ${index === 0 ? "active" : ""}">
                  <span class="timeline-dot"></span>
                  <strong>${formatTime(slot.at)}</strong>
                  <div><b>${index === 0 ? escapeHtml(current.chapterTitle) : `第 ${slot.ordinal} 段`}</b><small>${index === 0 ? escapeHtml(current.helperTitle) : escapeHtml(slot.label)}</small></div>
                  ${index === 0 ? `<button data-action="show-reading-popup">去阅读</button>` : `<em>未开始</em>`}
                </div>`).join("") : `<div class="timeline-empty">${current ? "今天没有自动提醒，仍可随时从悬浮图标开始阅读。" : "导入内容后，提醒会从第一段开始安排。"}</div>`}
            </div>
          </article>
        </section>

        <footer class="minimal-footer">保持专注，持续积累，时间会给你答案。</footer>
      </div>`;
  }

  function renderLibraryView(state: AppState): string {
    const activeBooks = sortBooksForLibrary(state, "recent");
    const currentBookId = currentBook(state)?.id || "";
    const totalSegments = activeBooks.reduce((sum, book) => sum + book.segmentCount, 0);
    return `
      <div class="page page-library">
        <header class="page-heading">
          <div><span class="eyebrow">内容来源</span><h1>书架</h1><p>${activeBooks.length} 个来源 · ${totalSegments} 个可阅读片段，全部默认保存在本机。</p></div>
          <button class="primary-button" data-action="open-import">${icon("plus", 17)}导入一本书或文档</button>
        </header>
        <div class="library-toolbar">
          <label class="search-field">${icon("search", 17)}<input id="library-search" placeholder="搜索书名、作者或格式" autocomplete="off"></label>
          <div class="filter-chips">
            <button class="chip active" data-library-filter="all">全部</button>
            <button class="chip" data-library-filter="classic">经典</button>
            <button class="chip" data-library-filter="document">文档</button>
            <button class="chip" data-library-filter="article">网页</button>
          </div>
          <label class="library-sort-control">
            <span>排序</span>
            <select id="library-sort" aria-label="书架排序">
              <option value="recent">最近阅读</option>
              <option value="imported">最近导入</option>
              <option value="progress">阅读进度</option>
              <option value="title">书名</option>
            </select>
          </label>
          <span class="local-badge">${icon("shield", 15)}Local-first</span>
        </div>
        <section class="book-grid ${activeBooks.length ? "" : "book-grid-empty"}" id="book-grid">
          ${activeBooks.length ? activeBooks.map((book) => {
            const progress = progressForBook(state, book.id);
            const isCurrent = book.id === currentBookId;
            const resumeTarget = resumeSegmentForBook(state, book.id);
            const completed = progress.total > 0 && progress.read === progress.total;
            return `
              <article class="book-card ${isCurrent ? "is-current" : ""}" data-book-id="${book.id}" data-book-kind="${book.kind}" data-search-text="${escapeHtml(`${book.title} ${book.author} ${book.format}`.toLowerCase())}">
                <button class="book-card-main" data-action="open-book" data-book-id="${book.id}">
                  ${bookCover(book)}
                  <div class="book-card-copy">
                    <div class="book-card-tags">${isCurrent ? `<span class="library-current-badge">${icon("play", 10)}正在读</span>` : ""}${statusPill(book.kind === "classic" ? "经典" : book.kind === "article" ? "网页" : "文档", "muted")} ${statusPill(book.format.toUpperCase(), "info")}</div>
                    <h3>${escapeHtml(book.title)}</h3>
                    <p>${escapeHtml(book.author)}</p>
                    ${progressBar(progress.percent)}
                    <small>确认读完 ${progress.read}/${progress.total} · 浏览 ${progress.browsed} 段</small>
                    ${resumeTarget ? `<span class="book-resume-copy" title="${escapeHtml(resumeTarget.chapterTitle)}">${icon(completed ? "rotate" : "play", 11)}<span>${completed ? "已读完，可重新阅读" : `从第 ${resumeTarget.sequence} 段 · ${escapeHtml(resumeTarget.chapterTitle)} 继续`}</span></span>` : ""}
                  </div>
                </button>
                <footer>
                  <button class="text-button ${isCurrent ? "current-book-action" : ""}" data-action="${isCurrent ? "continue-book" : "open-book"}" data-book-id="${book.id}">${icon("play", 15)}${completed ? "重新阅读" : isCurrent && resumeTarget ? `继续第 ${resumeTarget.sequence} 段` : "选择阅读位置"}</button>
                  <button class="text-button book-manage-button" data-action="open-book" data-book-id="${book.id}">${icon("more", 15)}管理</button>
                </footer>
              </article>`;
          }).join("") : emptyState("library", "书架中还没有内容", "可以导入 TXT、Markdown，或让 Agent 把 PDF、EPUB、DOCX 转换成弹阅导入包。", `<button class="primary-button" data-action="open-import">${icon("plus", 16)}导入一本书或文档</button>`)}
        </section>
      </div>`;
  }

  function renderPlanView(state: AppState): string {
    const slots = getUpcomingSlots(state.schedule, new Date(), 8);
    const health = scheduleHealth(state.schedule);
    const pause = activeReminderPause(state.schedule);
    const segment = currentSegment(state);
    const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    return `
      <div class="page page-plan">
        <header class="page-heading">
          <div><span class="eyebrow">节奏而非打卡</span><h1>阅读计划</h1><p>先设置可接受的范围，再由系统在时间窗口内均匀安排。</p></div>
          <div class="schedule-master-toggle">
            <span><strong>自动提醒</strong><small>${pause ? `${pause.kind === "today" ? "今天暂停" : "已延后"}，${formatTime(pause.until)} 恢复` : state.schedule.enabled ? "正在运行" : "当前暂停"}</small></span>
            ${pause ? `<button class="text-button" data-action="resume-reminders">立即恢复</button>` : `<label class="switch large"><input type="checkbox" data-setting="schedule.enabled" ${state.schedule.enabled ? "checked" : ""}><span class="switch-track"><span></span></span></label>`}
          </div>
        </header>
        <section class="plan-grid">
          <div class="plan-form-column">
            <article class="panel form-panel">
              <header class="panel-header"><div><span class="eyebrow">一周中的哪几天</span><h3>工作日</h3></div></header>
              <div class="weekday-picker">
                ${weekdayLabels.map((label, day) => `<button class="weekday ${state.schedule.weekdays.includes(day) ? "active" : ""}" data-action="toggle-weekday" data-day="${day}"><span>${label}</span><small>${day === 0 || day === 6 ? "休" : "工"}</small></button>`).join("")}
              </div>
            </article>

            <article class="panel form-panel">
              <header class="panel-header"><div><span class="eyebrow">每天出现几次</span><h3>每日阅读数量</h3></div><strong class="big-value"><span id="daily-count-value">${state.schedule.dailyCount}</span> 段</strong></header>
              <input class="range-input" type="range" min="1" max="12" step="1" value="${state.schedule.dailyCount}" data-setting="schedule.dailyCount">
              <div class="range-labels"><span>轻量 1</span><span>推荐 3—6</span><span>密集 12</span></div>
              <p class="inline-tip">${icon("sparkles", 16)}系统会把提醒均匀分布在已启用的时段中，而不是固定机械间隔。</p>
            </article>

            <article class="panel form-panel">
              <header class="panel-header"><div><span class="eyebrow">允许出现的范围</span><h3>提醒时段</h3></div><button class="text-button" data-action="add-window">${icon("plus", 15)}添加时段</button></header>
              <div class="time-window-list">
                ${state.schedule.windows.map((windowItem) => `
                  <div class="time-window-row" data-window-id="${windowItem.id}">
                    <label class="switch small-switch"><input type="checkbox" data-window-field="enabled" data-window-id="${windowItem.id}" ${windowItem.enabled ? "checked" : ""}><span class="switch-track"><span></span></span></label>
                    <input class="label-input" value="${escapeHtml(windowItem.label)}" data-window-field="label" data-window-id="${windowItem.id}" aria-label="时段名称">
                    <label class="time-input">${icon("clock", 15)}<input type="time" value="${windowItem.start}" data-window-field="start" data-window-id="${windowItem.id}"></label>
                    <span>至</span>
                    <label class="time-input"><input type="time" value="${windowItem.end}" data-window-field="end" data-window-id="${windowItem.id}"></label>
                    <button class="icon-button small" data-action="remove-window" data-window-id="${windowItem.id}" aria-label="删除时段">${icon("trash", 16)}</button>
                  </div>`).join("")}
              </div>
              <div class="quiet-time-row">
                <span><strong>安静时段</strong><small>此范围内不自动弹出</small></span>
                <label class="time-input">从 <input type="time" value="${state.schedule.quietStart}" data-setting="schedule.quietStart"></label>
                <label class="time-input">到 <input type="time" value="${state.schedule.quietEnd}" data-setting="schedule.quietEnd"></label>
              </div>
            </article>

            <article class="panel form-panel">
              <header class="panel-header"><div><span class="eyebrow">每段有多长</span><h3>阅读与停留时间</h3></div></header>
              <div class="duration-grid">
                <div><label>当前片段预计阅读</label><div class="duration-current-value"><strong>${segment ? readingTimeLabel(segment) : "暂无片段"}</strong><small>按正文长度估算，与弹窗同步</small></div></div>
                <div><label for="display-mode">弹窗自动收起</label><select id="display-mode" data-setting="schedule.displayMode"><option value="adaptive" ${state.schedule.displayMode === "adaptive" ? "selected" : ""}>按内容自适应（推荐）</option><option value="fixed" ${state.schedule.displayMode === "fixed" ? "selected" : ""}>固定时间</option></select></div>
                <div><label for="display-seconds">固定停留时间</label><select id="display-seconds" data-setting="schedule.displaySeconds" ${state.schedule.displayMode === "adaptive" ? "disabled" : ""}>${[15, 30, 45, 60, 75, 90].map((value) => `<option value="${value}" ${state.schedule.displaySeconds === value ? "selected" : ""}>${value} 秒</option>`).join("")}</select></div>
              </div>
            </article>
          </div>

          <aside class="plan-preview-column">
            <article class="schedule-preview-card">
              <span class="eyebrow">未来提醒预览</span>
              <h3>${slots[0] ? `${formatRelativeTime(slots[0].at)}出现下一段` : "当前没有可用时段"}</h3>
              <div class="preview-timeline">
                ${slots.map((slot, index) => `<div class="preview-slot ${index === 0 ? "active" : ""}"><span>${formatTime(slot.at)}</span><i></i><small>${slot.label}</small></div>`).join("")}
              </div>
              <div class="health-summary health-${health.tone}">${icon(health.tone === "good" ? "check" : "bell", 18)}<span><strong>${escapeHtml(health.message)}</strong><small>建议先使用一周，再根据关闭频率调整。</small></span></div>
              <button class="primary-button full-width" data-action="show-reading-popup">预览一次真实弹窗</button>
            </article>
            <article class="panel smart-rules-panel">
              <header class="panel-header compact-header"><div><span class="eyebrow">阅读时控制</span><h3>倒计时</h3></div></header>
              ${toggleControl("hoverPausesTimer", state.settings.hoverPausesTimer, "悬停暂停倒计时", "鼠标移入代表用户正在阅读")}
            </article>
          </aside>
        </section>
      </div>`;
  }

  function renderFavoritesView(state: AppState): string {
    const favorites = state.segments.filter((segment) => segment.favorite);
    return `
      <div class="page page-favorites">
        <header class="page-heading">
          <div><span class="eyebrow">回到真正有感触的内容</span><h1>收藏与笔记</h1><p>${favorites.length} 个收藏片段，均保留原书位置和内容指纹。</p></div>
          <button class="secondary-button" data-action="export-favorites">${icon("download", 17)}导出 Markdown</button>
        </header>
        <div class="favorites-toolbar">
          <label class="search-field">${icon("search", 17)}<input id="favorite-search" placeholder="搜索收藏内容" autocomplete="off"></label>
          <span>${icon("shield", 15)}不会把原文自动上传到云端</span>
        </div>
        <section class="favorite-list" id="favorite-list">
          ${favorites.length ? favorites.map((segment) => {
            const book = state.books.find((item) => item.id === segment.bookId)!;
            return `
              <article class="favorite-card" data-search-text="${escapeHtml(`${book.title} ${segment.chapterTitle} ${segment.originalText} ${segment.note}`.toLowerCase())}">
                <div class="favorite-book-mark" style="--book-accent:${book.accent}">${bookCover(book, true)}</div>
                <div class="favorite-content">
                  <div class="favorite-meta"><span>${escapeHtml(book.title)} · ${escapeHtml(segment.chapterTitle)}</span><small>${segment.sourceAnchor.label}</small></div>
                  <h3>${escapeHtml(segment.helperTitle)}</h3>
                  <blockquote>${escapeHtml(segment.originalText)}</blockquote>
                  ${segment.note ? `<div class="note-box">${icon("note", 16)}<span>${escapeHtml(segment.note)}</span></div>` : `<button class="add-note-link" data-action="edit-note" data-segment-id="${segment.id}">${icon("plus", 15)}添加自己的笔记</button>`}
                </div>
                <div class="favorite-actions">
                  <button class="icon-button" data-action="toggle-favorite" data-segment-id="${segment.id}" title="取消收藏">${icon("heart", 18, "heart-filled")}</button>
                  <button class="secondary-button small-button" data-action="open-segment" data-segment-id="${segment.id}">打开原文</button>
                </div>
              </article>`;
          }).join("") : emptyState("heart", "还没有收藏", "在阅读卡片中点一下心形，这里就会保留原文和位置。", `<button class="primary-button" data-action="show-reading-popup">读一段试试</button>`)}
        </section>
      </div>`;
  }

  function renderUpdateStatus(update: UpdateUiState): string {
    switch (update.phase) {
      case "idle":
        return "";
      case "checking":
        return `<div class="update-status"><span class="update-status-text">正在检查更新…</span></div>`;
      case "up-to-date":
        return `<div class="update-status update-status-good"><span class="update-status-text">已是最新版本 v${escapeHtml(update.currentVersion || "")}</span></div>`;
      case "available": {
        const announcement = update.announcement;
        if (!announcement) return "";
        return `<div class="update-status update-status-available">
          <span class="update-status-text">发现新版本 <strong>v${escapeHtml(announcement.version)}</strong>（当前 v${escapeHtml(announcement.currentVersion)}）</span>
          ${announcement.notes ? `<p class="update-notes">${escapeHtml(announcement.notes)}</p>` : ""}
          <div><button class="secondary-button compact" data-action="download-update">${icon("download", 15)}下载更新</button></div>
        </div>`;
      }
      case "downloading": {
        const progress = update.progress;
        const percent = progress?.percent ?? null;
        const totalText = progress?.total ? ` / ${formatDownloadSize(progress.total)}` : "";
        return `<div class="update-status"><span class="update-status-text">正在下载更新… ${percent !== null ? `${percent}% · ` : ""}${formatDownloadSize(progress?.downloaded || 0)}${totalText}</span></div>`;
      }
      case "ready":
        return `<div class="update-status update-status-good">
          <span class="update-status-text">更新已下载并验签，点击后安装并重启。</span>
          <div><button class="primary-button compact" data-action="install-update">重启并安装</button></div>
        </div>`;
      case "error":
        return `<div class="update-status update-status-error"><span class="update-status-text">${escapeHtml(update.error || "检查更新失败")}</span><div><button class="text-button" data-action="check-update">${icon("rotate", 14)}重试</button></div></div>`;
      default:
        return "";
    }
  }

  function renderSettingsView(state: AppState, update: UpdateUiState): string {
    const mode = DesktopBridge.isTauri() ? "Tauri 桌面模式" : "浏览器演示模式";
    const fontScale = normalizeReadingFontScale(state.settings.fontScale);
    const fontScalePercent = Math.round(fontScale * 100);
    const popupSizeDescription: Record<PopupSizeMode, string> = {
      adaptive: "按正文自适应，最多 600 × 720",
      compact: "最多 520 × 560，超出时正文滚动",
      small: "最多 480 × 460，适合低调阅读"
    };
    return `
      <div class="page page-settings">
        <header class="page-heading"><div><span class="eyebrow">少一点复杂，多一点可控</span><h1>设置</h1><p>所有影响打扰程度的选项都集中在这里。</p></div>${statusPill(mode, "good")}</header>
        <section class="settings-layout">
          <div class="settings-main">
            <article class="panel settings-section">
              <header class="settings-section-header"><div class="settings-section-icon">${icon("monitor", 20)}</div><div><h3>桌面行为</h3><p>启动、托盘与通知方式</p></div></header>
              ${toggleControl("autostart", state.settings.autostart, "开机自动启动", DesktopBridge.isTauri() ? "由 Tauri Autostart 插件管理" : "浏览器中仅保存偏好，打包后生效")}
              ${toggleControl("floatingWidget", state.settings.floatingWidget, "显示桌面悬浮图标", "收起时只保留一个安静的小图标，点击即可阅读")}
              ${toggleControl("nativeNotifications", state.settings.nativeNotifications, "弹窗前发送系统通知", "默认关闭，避免重复打扰")}
            </article>

            <article class="panel settings-section">
              <header class="settings-section-header"><div class="settings-section-icon">${icon("eye", 20)}</div><div><h3>阅读外观</h3><p>只调整阅读体验，不改动原文</p></div></header>
              <div class="setting-block-row"><span class="setting-copy"><strong>主题</strong><small>跟随系统或固定明暗模式</small></span><div class="segmented-control">${(["system", "light", "dark"] as ThemeMode[]).map((value) => `<button data-action="set-theme" data-theme="${value}" class="${state.settings.theme === value ? "active" : ""}">${value === "system" ? "跟随系统" : value === "light" ? "浅色" : "深色"}</button>`).join("")}</div></div>
              <div class="setting-block-row"><span class="setting-copy"><strong>正文字体</strong><small>不随意捆绑第三方字体文件</small></span><div class="segmented-control"><button data-action="set-reading-font" data-font="serif" class="${state.settings.readingFont === "serif" ? "active" : ""}">宋体风格</button><button data-action="set-reading-font" data-font="sans" class="${state.settings.readingFont === "sans" ? "active" : ""}">黑体风格</button></div></div>
              <div class="setting-block-row font-scale-setting">
                <span class="setting-copy"><strong>字体大小</strong><small id="font-scale-value">当前 ${fontScalePercent}% · 调整时弹窗即时变化</small></span>
                <div class="font-scale-control">
                  <input class="range-input compact-range font-scale-range" type="range" min="${READING_FONT_SCALE_MIN}" max="${READING_FONT_SCALE_MAX}" step="${READING_FONT_SCALE_STEP}" value="${fontScale}" data-setting="settings.fontScale" aria-label="阅读正文字体大小" aria-describedby="font-scale-value" aria-valuetext="${fontScalePercent}%" style="--range-progress:${readingFontScaleProgress(fontScale)}%">
                  <div class="font-scale-labels" aria-hidden="true"><span>极小 50%</span><span>标准 100%</span><span>大 150%</span></div>
                </div>
              </div>
              <div class="setting-block-row"><span class="setting-copy"><strong>弹窗占屏上限</strong><small>${popupSizeDescription[state.settings.popupSizeMode]}</small></span><div class="segmented-control"><button data-action="set-popup-size" data-popup-size="adaptive" class="${state.settings.popupSizeMode === "adaptive" ? "active" : ""}">自适应</button><button data-action="set-popup-size" data-popup-size="compact" class="${state.settings.popupSizeMode === "compact" ? "active" : ""}">紧凑</button><button data-action="set-popup-size" data-popup-size="small" class="${state.settings.popupSizeMode === "small" ? "active" : ""}">小窗</button></div></div>
              ${toggleControl("showExplanation", state.settings.showExplanation, "默认显示一句话理解", "辅助解释与原文始终分层展示")}
              ${toggleControl("adSkin", state.settings.adSkin, "摸鱼广告皮肤", "阅读卡片换成广告外观，正文与操作保持不变")}
              ${toggleControl("reduceMotion", state.settings.reduceMotion, "减少动画", "降低弹窗和侧栏的过渡效果")}
            </article>

            <article class="panel settings-section">
              <header class="settings-section-header"><div class="settings-section-icon">${icon("download", 20)}</div><div><h3>关于与更新</h3><p>本地优先，需要时再联网</p></div></header>
              <div class="setting-block-row">
                <span class="setting-copy"><strong>当前版本</strong><small>${update.currentVersion ? `v${escapeHtml(update.currentVersion)}` : `${APP_VERSION}（桌面版运行后显示实际版本）`}</small></span>
                <button class="secondary-button compact" data-action="check-update" ${["checking", "downloading", "ready"].includes(update.phase) ? "disabled" : ""}>${update.phase === "checking" ? "检查中…" : "检查更新"}</button>
              </div>
              ${renderUpdateStatus(update)}
            </article>

          </div>

          <aside class="settings-side">
            <article class="data-card">
              <span class="eyebrow">本地数据</span><h3>${state.books.length} 个来源</h3><p>${state.segments.length} 个片段 · ${state.events.length} 条行为记录</p>
              <button class="secondary-button full-width" data-action="export-data">${icon("download", 16)}导出全部数据</button>
              <button class="secondary-button full-width" data-action="restore-data">${icon("rotate", 16)}从备份恢复</button>
              <input id="restore-input" type="file" accept=".json" hidden>
              ${!DesktopBridge.isTauri() ? '<button class="text-button full-width" data-action="export-restore-backup">导出恢复前备份</button>' : ""}
              <button class="text-button danger-text full-width" data-action="reset-demo">${icon("rotate", 15)}恢复初始内容</button>
            </article>
            <article class="panel shortcut-card">
              <span class="eyebrow">快捷键</span>
              <div><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>R</kbd><span>立即读一段</span></div>
              <div><kbd>Ctrl</kbd><kbd>K</kbd><span>搜索</span></div>
              <div><kbd>Esc</kbd><span>关闭弹层</span></div>
            </article>
            <article class="version-card"><div class="brand-mark small-mark">${brandGlyph()}</div><div><strong>${BRAND.name} ${APP_VERSION}</strong><small>内置《道德经》、五卷《毛泽东选集》与《毛主席语录》</small></div></article>
          </aside>
        </section>
      </div>`;
  }

  export function renderImportModal(state: AppState): string {
    const content = `
      <section class="import-pane active" data-import-pane="file">
        <label class="drop-zone" id="drop-zone">
          <input id="file-input" type="file" accept=".txt,.md,.markdown,.json" multiple>
          <span class="drop-icon">${icon("upload", 28)}</span>
          <strong>拖入正文或 Agent 导入包</strong>
          <p>弹阅直接读取 TXT、Markdown；PDF、EPUB、DOCX 和网页请由 Agent 转换为 .tanyue.json。</p>
          <span class="secondary-button">选择文件</span>
        </label>
        <div class="import-options">
          <div><label>新内容每段目标时长</label><div class="segmented-control">${([30, 60, 90] as const).map((value) => `<button class="${state.schedule.targetSeconds === value ? "active" : ""}" data-action="set-import-duration" data-seconds="${value}">${value} 秒</button>`).join("")}</div></div>
          <div class="import-format-list"><span>TXT</span><span>MD</span><span>Agent JSON</span></div>
        </div>
      </section>`;
    return modalShell("import-modal", "添加阅读内容", "外部 Agent 负责解析和切片，弹阅会重新检查原文覆盖后再入库。", content, true);
  }

  export function renderImportPreview(results: ImportResult[], errors: string[] = []): string {
    const content = `${errors.length ? `<div role="alert"><h3>以下文件未能导入</h3><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>` : ""}
      ${results.map((result) => `<article class="import-preview-book">
        <h3>${escapeHtml(result.book.title)}</h3>
        <p>${result.segments.length} 个片段 · ${result.book.totalChars.toLocaleString()} 字 · 正文覆盖率 ${result.coverage.coveragePercent}%</p>
        ${result.warnings.length ? `<ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}
        ${result.segments.slice(0, 3).map((segment) => `<details><summary>第 ${segment.sequence} 段 · ${escapeHtml(segment.chapterTitle)} · 约 ${segment.estimatedSeconds} 秒</summary><p class="import-preview-text">${escapeHtml(segment.originalText)}</p></details>`).join("")}
      </article>`).join("")}
      <p>覆盖率只验证导入内容的完整性，请检查样例是否有乱码、错序或缺失。</p>
      <p id="import-save-status" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button>${results.length ? '<button class="primary-button" data-action="confirm-import">确认导入</button>' : ""}</div>`;
    return modalShell("import-preview", "检查导入内容", "确认后保存到本机书架。", content, true);
  }

  export function renderRestorePreview(current: AppState, incoming: AppState): string {
    const summary = (state: AppState): string => `${state.books.length} 本书、${state.segments.length} 段、${state.segments.filter((item) => item.status === "confirmed").length} 段确认读完、${state.segments.filter((item) => item.favorite).length} 条收藏、${state.segments.filter((item) => item.note.trim()).length} 条笔记`;
    return modalShell("restore-preview", "从备份恢复", "这会替换当前书库、阅读进度、收藏、笔记与阅读计划。", `
      <p>当前：${summary(current)}</p><p>备份：${summary(incoming)}</p>
      <ul>${incoming.books.map((book) => `<li>${escapeHtml(book.title)}</li>`).join("")}</ul>
      <p>恢复前会自动保存当前完整数据，备份失败时不会执行恢复。系统开机启动保持当前设置。</p>
      <p id="restore-status" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-restore">备份当前数据并恢复</button></div>`);
  }

  export function renderBookModal(state: AppState, bookId: string): string {
    const book = state.books.find((item) => item.id === bookId);
    if (!book) return modalShell("book-modal", "书籍不存在", "它可能已经从书架中删除。", emptyState("library", "没有找到这本书", "关闭弹层后可继续管理书架。"));
    const segments = getBookSegments(state, book.id);
    const progress = progressForBook(state, book.id);
    const activeBook = currentBook(state);
    const isCurrent = activeBook?.id === book.id;
    const resumeTarget = resumeSegmentForBook(state, book.id);
    const completed = progress.total > 0 && progress.read === progress.total;
    const resumeTitle = resumeTarget ? `第 ${resumeTarget.sequence} 段 · ${resumeTarget.chapterTitle}` : "没有可阅读片段";
    const content = `
      <div class="book-detail-hero">
        ${bookCover(book)}
        <div><div class="book-card-tags">${isCurrent ? `<span class="library-current-badge">${icon("play", 10)}正在读</span>` : ""}${statusPill(book.format.toUpperCase(), "info")} ${statusPill(`${segments.length} 段`, "muted")}</div><h2>${escapeHtml(book.title)}</h2><p>${escapeHtml(book.author)}</p><p class="detail-description">${escapeHtml(book.description)}</p>${progressBar(progress.percent, `${progress.read}/${progress.total} 已读`)}</div>
      </div>
      <div class="book-detail-read-state ${isCurrent ? "is-current" : ""}">
        <span>${icon(isCurrent ? "play" : "library", 18)}</span>
        <div><small>${isCurrent ? "当前阅读位置" : "这本书的接续位置"}</small><strong>${escapeHtml(resumeTitle)}</strong><p>${isCurrent ? "首页、悬浮弹窗和阅读计划都会从这里继续。" : activeBook ? `当前正在读《${escapeHtml(activeBook.title)}》；切换后从这里继续，原来的进度仍会保留。` : "选择后会把这本书设为当前阅读内容。"}</p></div>
      </div>
      <div class="book-detail-actions"><button class="primary-button" data-action="continue-book" data-book-id="${book.id}" ${resumeTarget ? "" : "disabled"}>${icon(completed ? "rotate" : "play", 16)}${completed ? "从第 1 段重新阅读" : isCurrent && resumeTarget ? `继续第 ${resumeTarget.sequence} 段` : resumeTarget ? `切换并从第 ${resumeTarget.sequence} 段继续` : "没有可阅读片段"}</button>${book.sourceUrl ? `<button class="secondary-button" data-action="open-source-url" data-url="${escapeHtml(book.sourceUrl)}">${icon("external", 16)}打开来源</button>` : ""}<button class="secondary-button danger-outline-button book-delete-action" data-action="request-delete-book" data-book-id="${book.id}">${icon("trash", 16)}删除本书</button></div>
      <div class="book-detail-section-header"><div><strong>选择章节或片段</strong><small>点击任意一段，会把它设为新的当前阅读位置并打开正文。</small></div><label class="book-segment-search">${icon("search", 14)}<input id="book-segment-search" placeholder="搜索章节或段号" autocomplete="off"></label></div>
      <div class="book-detail-list" id="book-segment-list">${segments.map((segment) => segmentListItem(segment, segment.id === resumeTarget?.id, segment.id === resumeTarget?.id, true)).join("")}</div>`;
    return modalShell("book-modal", book.title, `${book.sourceName} · ${book.totalChars.toLocaleString()} 字`, content, true);
  }

  export function renderDeleteBookModal(state: AppState, bookId: string): string {
    const book = state.books.find((item) => item.id === bookId);
    if (!book) return modalShell("delete-book-modal", "书籍不存在", "它可能已经从书架中删除。", `<div class="modal-footer"><button class="primary-button" data-action="close-modal">知道了</button></div>`);
    const segments = getBookSegments(state, book.id);
    const favoriteCount = segments.filter((segment) => segment.favorite).length;
    const noteCount = segments.filter((segment) => Boolean(segment.note.trim())).length;
    const content = `
      <div class="delete-book-warning">
        <span>${icon("trash", 22)}</span>
        <div><strong>这会永久删除弹阅中的本地阅读数据</strong><p>${segments.length} 个片段及其阅读进度${favoriteCount ? `、${favoriteCount} 个收藏` : ""}${noteCount ? `、${noteCount} 条笔记` : ""}会一起删除。</p></div>
      </div>
      <p class="delete-book-source-note">原始文件或 Agent 导入包不会被删除，以后仍可重新导入。</p>
      <div class="modal-footer"><button class="secondary-button" data-action="cancel-delete-book" data-book-id="${book.id}">取消</button><button class="danger-button" data-action="confirm-delete-book" data-book-id="${book.id}">${icon("trash", 16)}确认删除</button></div>`;
    return modalShell("delete-book-modal", `删除《${book.title}》？`, "删除后无法在弹阅内恢复。", content);
  }

  export function renderReaderPanel(state: AppState, segmentId?: string): string {
    const segment = state.segments.find((item) => item.id === segmentId) || currentSegment(state);
    if (!segment) return "";
    const book = state.books.find((item) => item.id === segment.bookId) || currentBook(state);
    if (!book) return "";
    const segments = getBookSegments(state, book.id);
    const progress = progressForBook(state, book.id);
    const previous = previousSegment(state, segment.id);
    const next = nextSegment(state, segment.id);
    const readingHeading = readingHeadingForSegment(state, segment);
    return `
      <div class="reader-backdrop" data-action="close-reader">
        <aside class="reader-panel" role="dialog" aria-modal="true" aria-label="连续阅读">
          <header class="reader-header">
            <div class="reader-book-title">${bookCover(book, true)}<span><small>${escapeHtml(book.author)}</small><strong>${escapeHtml(book.title)}</strong></span></div>
            <div class="reader-header-actions"><span>${progress.read}/${progress.total}</span><button class="icon-button" data-action="close-reader">${icon("close", 20)}</button></div>
          </header>
          <div class="reader-body">
            <nav class="reader-toc"><span class="eyebrow">目录与片段</span><div>${segments.map((item) => segmentListItem(item, item.id === segment.id)).join("")}</div></nav>
            <article class="reader-content">
              <div class="reader-content-meta"><span>${readingHeading ? "" : escapeHtml(segment.chapterTitle)}</span><small>${readingTimeLabel(segment)} · ${escapeHtml(segment.sourceAnchor.label)}</small></div>
              ${readingHeading ? `<h1>${escapeHtml(readingHeading)}</h1>` : ""}
              <div class="original-text ${state.settings.readingFont === "sans" ? "font-sans" : ""}">${segment.originalText.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
              ${state.settings.showExplanation && segment.explanation ? `<section class="explanation-box"><span>${icon("sparkles", 18)}一句话理解</span><p>${escapeHtml(segment.explanation)}</p></section>` : ""}
              <section class="reader-note-section"><label for="reader-note">我的笔记</label><textarea id="reader-note" data-segment-id="${segment.id}" placeholder="写下自己的理解，不修改原文……">${escapeHtml(segment.note)}</textarea><small>失焦后自动保存到本机。</small></section>
              <footer class="reader-content-footer">
                <button class="secondary-button" data-action="reader-prev" data-segment-id="${segment.id}" ${previous ? "" : "disabled"}>${icon("chevronLeft", 16)}上一段</button>
                <button class="icon-button ${segment.favorite ? "active" : ""}" data-action="toggle-favorite" data-segment-id="${segment.id}" aria-label="收藏">${icon("heart", 19)}</button>
                <button class="primary-button" data-action="reader-next" data-segment-id="${segment.id}">${next ? `确认读完并继续 ${icon("arrowRight", 16)}` : `完成本书 ${icon("check", 16)}`}</button>
              </footer>
            </article>
          </div>
        </aside>
      </div>`;
  }

  export function renderNoteModal(state: AppState, segmentId: string): string {
    const segment = state.segments.find((item) => item.id === segmentId) || currentSegment(state);
    if (!segment) return modalShell("note-modal", "片段不存在", "它所属的书籍可能已经删除。", `<div class="modal-footer"><button class="primary-button" data-action="close-modal">知道了</button></div>`);
    const content = `<label class="note-editor"><span>${escapeHtml(segment.chapterTitle)} · ${escapeHtml(segment.helperTitle)}</span><textarea id="modal-note" data-segment-id="${segment.id}" placeholder="记录自己的理解……">${escapeHtml(segment.note)}</textarea><small>笔记只属于用户，不会改写或覆盖原文。</small></label><div class="modal-footer"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="save-note" data-segment-id="${segment.id}">保存笔记</button></div>`;
    return modalShell("note-modal", "添加笔记", "保留来源位置，方便以后回到完整上下文。", content);
  }
}
