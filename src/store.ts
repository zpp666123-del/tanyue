namespace TanYue {
  type PersistedSegment = Omit<Segment, "sourceRuns" | "processingTrace"> & Partial<Pick<Segment, "sourceRuns" | "processingTrace">>;

  export function hydrateSegmentTrace(segment: Segment): Segment {
    const persisted = segment as PersistedSegment;
    const legacy = createLegacySegmentMetadata(persisted.id, persisted.originalText, persisted.sourceAnchor, persisted.confirmedAt);
    const trace = persisted.processingTrace;
    return {
      ...persisted,
      sourceRuns: Array.isArray(persisted.sourceRuns) && persisted.sourceRuns.length ? persisted.sourceRuns : legacy.sourceRuns,
      processingTrace: trace ? {
        ...legacy.processingTrace,
        ...trace,
        aiPromptVersion: trace.aiPromptVersion ?? null,
        aiModel: trace.aiModel ?? null
      } : legacy.processingTrace
    };
  }

  function mergeState(saved: Partial<AppState>, fallback: AppState): AppState {
    const settings = { ...fallback.settings, ...(saved.settings || {}) };
    settings.fontScale = normalizeReadingFontScale(settings.fontScale);
    return {
      ...fallback,
      ...saved,
      schemaVersion: 1,
      books: Array.isArray(saved.books) ? saved.books : fallback.books,
      segments: Array.isArray(saved.segments)
        ? saved.segments.map(hydrateSegmentTrace)
        : fallback.segments,
      events: Array.isArray(saved.events) ? saved.events : fallback.events,
      schedule: { ...fallback.schedule, ...(saved.schedule || {}) },
      settings
    };
  }

  export function hydrateAppState(saved: Partial<AppState>): AppState | null {
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.books) || !Array.isArray(saved.segments)) return null;
    return mergeState(saved, createReleaseSeedState());
  }

  export function addEvent(state: AppState, event: Omit<ActivityEvent, "id" | "createdAt"> & { createdAt?: string }): void {
    state.events.unshift({
      ...event,
      id: uid("event"),
      createdAt: event.createdAt || new Date().toISOString()
    });
    state.events = state.events.slice(0, 2000);
  }

  export function getBookSegments(state: AppState, bookId: string): Segment[] {
    return state.segments
      .filter((segment) => segment.bookId === bookId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  export function currentSegment(state: AppState): Segment | null {
    return (
      state.segments.find((segment) => segment.id === state.currentSegmentId) ||
      state.segments.find((segment) => segment.bookId === state.activeBookId) ||
      state.segments[0] ||
      null
    );
  }

  export function currentBook(state: AppState): Book | null {
    const segment = currentSegment(state);
    return (
      state.books.find((book) => book.id === segment?.bookId) ||
      state.books.find((book) => book.id === state.activeBookId) ||
      state.books[0] ||
      null
    );
  }

  export function booksForContinueReading(state: AppState, limit = 3): Book[] {
    const activeBooks = state.books.filter((book) => !book.archived);
    const current = currentBook(state);
    if (!current || current.archived) return activeBooks.slice(0, Math.max(0, limit));
    return [current, ...activeBooks.filter((book) => book.id !== current.id)].slice(0, Math.max(0, limit));
  }

  export function resumeSegmentForBook(state: AppState, bookId: string): Segment | null {
    const book = state.books.find((item) => item.id === bookId && !item.archived);
    if (!book) return null;
    const segments = getBookSegments(state, bookId);
    if (!segments.length) return null;

    const activeSegment = state.activeBookId === bookId
      ? segments.find((segment) => segment.id === state.currentSegmentId)
      : undefined;
    const savedSegment = activeSegment || segments.find((segment) => segment.sequence === book.currentSequence);
    const needsReading = (segment: Segment): boolean => segment.status !== "confirmed" && !segment.dismissedAt;
    if (savedSegment && needsReading(savedSegment)) return savedSegment;
    if (!savedSegment) return segments.find(needsReading) || segments[0];

    return segments.find((segment) => segment.sequence > savedSegment.sequence && needsReading(segment))
      || segments.find(needsReading)
      || segments[0];
  }

  export function sortBooksForLibrary(state: AppState, mode: LibrarySortMode = "recent"): Book[] {
    const activeBooks = state.books.filter((book) => !book.archived);
    const currentId = currentBook(state)?.id;
    const originalOrder = new Map(activeBooks.map((book, index) => [book.id, index]));
    const fallback = (left: Book, right: Book): number =>
      (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
    const timestamp = (value?: string): number => {
      const parsed = value ? Date.parse(value) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return [...activeBooks].sort((left, right) => {
      if (left.id === currentId && right.id !== currentId) return -1;
      if (right.id === currentId && left.id !== currentId) return 1;

      if (mode === "title") {
        return left.title.localeCompare(right.title, "zh-CN", { numeric: true }) || fallback(left, right);
      }
      if (mode === "progress") {
        return progressForBook(state, right.id).percent - progressForBook(state, left.id).percent || fallback(left, right);
      }
      if (mode === "imported") {
        return timestamp(right.createdAt) - timestamp(left.createdAt) || fallback(left, right);
      }
      return timestamp(right.lastOpenedAt || right.updatedAt) - timestamp(left.lastOpenedAt || left.updatedAt)
        || fallback(left, right);
    });
  }

  export function setCurrentSegment(state: AppState, segmentId: string): void {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    state.currentSegmentId = segment.id;
    state.activeBookId = segment.bookId;
    const book = state.books.find((item) => item.id === segment.bookId);
    if (book) {
      book.currentSequence = segment.sequence;
      book.lastOpenedAt = new Date().toISOString();
      book.updatedAt = new Date().toISOString();
    }
  }

  export function nextSegment(state: AppState, fromId?: string): Segment | null {
    const from = state.segments.find((segment) => segment.id === (fromId || state.currentSegmentId)) || currentSegment(state);
    if (!from) return null;
    const bookSegments = getBookSegments(state, from.bookId);
    return bookSegments.find((segment) => segment.sequence > from.sequence) || null;
  }

  export function previousSegment(state: AppState, fromId?: string): Segment | null {
    const from = state.segments.find((segment) => segment.id === (fromId || state.currentSegmentId)) || currentSegment(state);
    if (!from) return null;
    const bookSegments = getBookSegments(state, from.bookId);
    return [...bookSegments].reverse().find((segment) => segment.sequence < from.sequence) || null;
  }

  export interface RemovedBookSummary {
    book: Book;
    segmentCount: number;
    favoriteCount: number;
    noteCount: number;
  }

  export function removeBook(state: AppState, bookId: string): RemovedBookSummary | null {
    const book = state.books.find((item) => item.id === bookId);
    if (!book) return null;

    const removedSegments = state.segments.filter((segment) => segment.bookId === bookId);
    const removedSegmentIds = new Set(removedSegments.map((segment) => segment.id));
    const activeBookRemoved = state.activeBookId === bookId;
    const currentSegmentRemoved = removedSegmentIds.has(state.currentSegmentId);

    state.books = state.books.filter((item) => item.id !== bookId);
    state.segments = state.segments.filter((segment) => segment.bookId !== bookId);
    state.events = state.events.filter((event) =>
      event.bookId !== bookId && (!event.segmentId || !removedSegmentIds.has(event.segmentId))
    );

    if (activeBookRemoved || currentSegmentRemoved || !currentSegment(state)) {
      const replacement = firstUnreadSegment(state) || state.segments[0] || null;
      state.activeBookId = replacement?.bookId || state.books[0]?.id || "";
      state.currentSegmentId = replacement?.id || "";
      if (replacement) setCurrentSegment(state, replacement.id);
    }

    if (!state.segments.length) {
      state.activeBookId = "";
      state.currentSegmentId = "";
      state.schedule.nextDueAt = undefined;
      state.schedule.lastTriggeredSlot = undefined;
    }

    return {
      book,
      segmentCount: removedSegments.length,
      favoriteCount: removedSegments.filter((segment) => segment.favorite).length,
      noteCount: removedSegments.filter((segment) => Boolean(segment.note.trim())).length
    };
  }

  export function firstUnreadSegment(state: AppState, preferredBookId = state.activeBookId, excludedBookId = ""): Segment | null {
    const activeBooks = state.books.filter((book) => !book.archived && book.id !== excludedBookId);
    const orderedBooks = [
      ...activeBooks.filter((book) => book.id === preferredBookId),
      ...activeBooks.filter((book) => book.id !== preferredBookId)
    ];
    for (const book of orderedBooks) {
      const unread = getBookSegments(state, book.id).find((segment) => segment.status !== "confirmed" && !segment.dismissedAt);
      if (unread) return unread;
    }
    return null;
  }

  export function markShown(state: AppState, segmentId: string): void {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    segment.status = segment.status === "confirmed" ? "confirmed" : "shown";
    segment.viewCount += 1;
    segment.lastShownAt = new Date().toISOString();
    addEvent(state, { type: "shown", segmentId, bookId: segment.bookId });
  }

  export function markConfirmed(state: AppState, segmentId: string): void {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    const now = new Date().toISOString();
    segment.status = "confirmed";
    segment.dismissedAt = undefined;
    segment.confirmedAt = now;
    segment.lastShownAt = segment.lastShownAt || now;
    segment.viewCount = Math.max(1, segment.viewCount);
    addEvent(state, { type: "confirmed", segmentId, bookId: segment.bookId });
  }

  export function dismissPopupAndAdvance(state: AppState, segmentId: string): Segment | null {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) return null;
    if (segment.status === "unread") markShown(state, segment.id);
    if (segment.status !== "confirmed") segment.dismissedAt = new Date().toISOString();

    const next = nextSegment(state, segment.id)
      || firstUnreadSegment(state, state.activeBookId, segment.bookId);
    if (next) setCurrentSegment(state, next.id);
    return next;
  }

  export function toggleFavorite(state: AppState, segmentId: string): boolean {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) return false;
    segment.favorite = !segment.favorite;
    if (segment.favorite) addEvent(state, { type: "favorite", segmentId, bookId: segment.bookId });
    return segment.favorite;
  }

  export interface AddImportedContentOptions {
    activate?: boolean;
    recordEvent?: boolean;
  }

  export function addImportedContent(state: AppState, result: ImportResult, options: AddImportedContentOptions = {}): void {
    const coverage = result.coverage;
    const sequencesValid = result.segments.every((segment, index) =>
      segment.bookId === result.book.id && segment.sequence === index + 1
    );
    const integrityValid = coverage.valid
      && coverage.coveragePercent === 100
      && coverage.duplicateRunCount === 0
      && coverage.gapCount === 0
      && coverage.outOfOrderCount === 0
      && coverage.emptySegmentCount === 0
      && coverage.segmentCount === result.segments.length
      && result.book.segmentCount === result.segments.length
      && result.segments.length > 0
      && sequencesValid;
    if (!integrityValid) {
      throw new Error(
        `导入完整性检查失败：覆盖率 ${coverage.coveragePercent}%，空洞 ${coverage.gapCount}，重复 ${coverage.duplicateRunCount}，乱序 ${coverage.outOfOrderCount}。`
      );
    }
    state.books.unshift(result.book);
    state.segments.unshift(...result.segments);
    if (options.activate !== false) {
      state.activeBookId = result.book.id;
      state.currentSegmentId = result.segments[0]?.id || state.currentSegmentId;
    }
    if (options.recordEvent !== false) {
      addEvent(state, { type: "imported", bookId: result.book.id, meta: { segments: result.segments.length } });
    }
  }

  export function progressForBook(state: AppState, bookId: string): {
    confirmed: number;
    dismissed: number;
    read: number;
    shown: number;
    total: number;
    percent: number;
  } {
    const segments = getBookSegments(state, bookId);
    const confirmed = segments.filter((segment) => segment.status === "confirmed").length;
    const dismissed = segments.filter((segment) => segment.status !== "confirmed" && Boolean(segment.dismissedAt)).length;
    const read = confirmed + dismissed;
    const shown = segments.filter((segment) => segment.status !== "unread").length;
    return {
      confirmed,
      dismissed,
      read,
      shown,
      total: segments.length,
      percent: segments.length ? Math.round((read / segments.length) * 100) : 0
    };
  }
}
