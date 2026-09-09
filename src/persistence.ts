namespace TanYue {
  export const RESTORE_BACKUP_KEY = "tanyue.before-restore.v1";

  export function parseStateBackup(raw: string): AppState {
    if (raw.length > 100_000_000) throw new Error("备份超过 1 亿字符限制");
    const fail = (path: string): never => { throw new Error(`备份校验失败：${path}`); };
    const object = (value: unknown, path: string): Record<string, unknown> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} 必须是对象`);
      return value as Record<string, unknown>;
    };
    const fields = (item: Record<string, unknown>, names: string, type: string, path: string): void => {
      for (const name of names.split(" ")) if (typeof item[name] !== type) fail(`${path}.${name} 类型错误`);
    };
    const list = (value: unknown, path: string): Record<string, unknown>[] => {
      if (!Array.isArray(value) || value.length > 100_000) fail(`${path} 必须是至多 10 万项的数组`);
      return (value as unknown[]).map((item, index) => object(item, `${path}[${index}]`));
    };
    const unique = (items: Record<string, unknown>[], path: string): Set<string> => {
      const ids = new Set<string>();
      for (const item of items) {
        if (typeof item.id !== "string" || !/^[\w.-]+$/.test(item.id) || ids.has(item.id)) fail(`${path} ID 无效或重复`);
        ids.add(item.id as string);
      }
      return ids;
    };
    const date = (value: unknown, path: string): void => {
      if (value !== undefined && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) fail(`${path} 日期无效`);
    };
    const anchor = (value: unknown): void => {
      const item = object(value, "来源锚点");
      fields(item, "kind value label", "string", "来源锚点");
      if (!["chapter", "line", "page", "cfi", "url"].includes(String(item.kind))) fail("来源锚点类型无效");
    };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("备份不是有效 JSON"); }
    const root = object(parsed, "备份");
    if (root.schemaVersion !== 1) fail("不支持的备份版本");
    fields(root, "activeBookId currentSegmentId selectedView lastOpenedAt", "string", "备份");
    fields(root, "onboardingComplete", "boolean", "备份");
    date(root.lastOpenedAt, "lastOpenedAt");
    if (!["today", "library", "plan", "favorites", "settings"].includes(String(root.selectedView))) fail("页面无效");
    if (root.contentSeedVersion !== undefined && (!Number.isSafeInteger(root.contentSeedVersion) || Number(root.contentSeedVersion) < 0)) fail("内容版本无效");
    const books = list(root.books, "书籍");
    const segments = list(root.segments, "片段");
    const events = list(root.events, "事件");
    const bookIds = unique(books, "书籍");
    const segmentIds = unique(segments, "片段");
    unique(events, "事件");
    for (const book of books) {
      fields(book, "title author kind format sourceName description accent coverStyle createdAt updatedAt", "string", "书籍");
      fields(book, "archived", "boolean", "书籍");
      if (!String(book.title).trim() || !/^#[\da-fA-F]{3,8}$/.test(String(book.accent))) fail("书名或封面颜色无效");
      if (!["ink", "paper", "forest", "night", "sun"].includes(String(book.coverStyle))) fail("封面类型无效");
      if (!["classic", "document", "article", "manual"].includes(String(book.kind)) || !["txt", "md", "url", "pdf", "docx", "epub", "json"].includes(String(book.format))) fail("书籍类型无效");
      for (const key of ["sourceUrl", "sourceHash", "sourceMediaType"]) if (book[key] !== undefined && typeof book[key] !== "string") fail(`书籍.${key} 无效`);
      for (const key of ["segmentCount", "totalChars", "currentSequence"]) if (!Number.isSafeInteger(book[key]) || Number(book[key]) < 0) fail(`书籍.${key} 无效`);
      for (const key of ["createdAt", "updatedAt", "lastOpenedAt"]) date(book[key], `书籍.${key}`);
    }
    const sequences = new Map<string, number[]>();
    for (const segment of segments) {
      fields(segment, "bookId chapterTitle helperTitle originalText contentHash note status", "string", "片段");
      fields(segment, "favorite", "boolean", "片段");
      if (!bookIds.has(String(segment.bookId))) fail("片段引用不存在的书籍");
      if (!["unread", "shown", "confirmed"].includes(String(segment.status))) fail("阅读状态无效");
      if (!String(segment.originalText).trim() || hashText(String(segment.originalText)) !== segment.contentHash) fail("原文内容哈希不一致");
      for (const key of ["sequence", "estimatedSeconds", "viewCount"]) if (!Number.isSafeInteger(segment[key]) || Number(segment[key]) < (key === "viewCount" ? 0 : 1)) fail(`片段.${key} 无效`);
      for (const key of ["lastShownAt", "dismissedAt", "confirmedAt"]) date(segment[key], `片段.${key}`);
      for (const key of ["contextBridge", "explanation"]) if (segment[key] !== undefined && typeof segment[key] !== "string") fail(`片段.${key} 无效`);
      anchor(segment.sourceAnchor);
      if (segment.sourceRuns !== undefined) for (const run of list(segment.sourceRuns, "来源范围")) {
        fields(run, "blockId contentHash", "string", "来源范围");
        if (!Number.isSafeInteger(run.startOffset) || !Number.isSafeInteger(run.endOffset) || Number(run.startOffset) < 0 || Number(run.endOffset) <= Number(run.startOffset)) fail("来源范围无效");
        anchor(run.sourceAnchor);
      }
      if (segment.processingTrace !== undefined) {
        const trace = object(segment.processingTrace, "追溯");
        fields(trace, "parserId parserVersion segmenterVersion ruleVersion createdAt", "string", "追溯");
        for (const key of ["aiPromptVersion", "aiModel"]) if (trace[key] !== null && typeof trace[key] !== "string") fail(`追溯.${key} 无效`);
      }
      const values = sequences.get(String(segment.bookId)) || [];
      values.push(Number(segment.sequence));
      sequences.set(String(segment.bookId), values);
    }
    for (const book of books) {
      const values = (sequences.get(String(book.id)) || []).sort((a, b) => a - b);
      if (values.length !== book.segmentCount || values.some((value, index) => value !== index + 1)) fail("片段数量或顺序不连续");
    }
    if (books.length ? !bookIds.has(String(root.activeBookId)) : root.activeBookId !== "") fail("当前书籍不存在");
    if (segments.length ? !segmentIds.has(String(root.currentSegmentId)) : root.currentSegmentId !== "") fail("当前片段不存在");
    if (segments.length && segments.find((item) => item.id === root.currentSegmentId)?.bookId !== root.activeBookId) fail("当前书籍与片段不一致");
    for (const event of events) {
      fields(event, "type createdAt", "string", "事件");
      date(event.createdAt, "事件.createdAt");
      if (!["shown", "confirmed", "snoozed", "favorite", "imported"].includes(String(event.type))) fail("事件类型无效");
      if (event.bookId !== undefined && !bookIds.has(String(event.bookId))) fail("事件书籍不存在");
      if (event.segmentId !== undefined && !segmentIds.has(String(event.segmentId))) fail("事件片段不存在");
      if (event.meta !== undefined && Object.values(object(event.meta, "事件详情")).some((value) => !["string", "number", "boolean"].includes(typeof value))) fail("事件详情无效");
    }
    const schedule = object(root.schedule, "计划");
    fields(schedule, "enabled", "boolean", "计划");
    if (!Array.isArray(schedule.weekdays) || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) fail("工作日无效");
    const time = (value: unknown): boolean => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!time(schedule.quietStart) || !time(schedule.quietEnd)) fail("安静时段无效");
    const windows = list(schedule.windows, "提醒时段");
    unique(windows, "提醒时段");
    for (const item of windows) {
      fields(item, "label", "string", "提醒时段");
      fields(item, "enabled", "boolean", "提醒时段");
      if (!time(item.start) || !time(item.end) || String(item.end) <= String(item.start)) fail("提醒时段无效");
    }
    for (const key of ["snoozeUntil", "pausedUntil", "nextDueAt", "lastTriggeredSlot"]) date(schedule[key], `计划.${key}`);
    if (!Number.isInteger(Number(schedule.dailyCount)) || Number(schedule.dailyCount) < 0 || Number(schedule.dailyCount) > 100) fail("每日提醒数量无效");
    if (![30, 60, 90].includes(Number(schedule.targetSeconds)) || !Number.isFinite(Number(schedule.displaySeconds)) || Number(schedule.displaySeconds) < 10 || Number(schedule.displaySeconds) > 300) fail("阅读时长无效");
    if (schedule.displayMode !== undefined && !["adaptive", "fixed"].includes(String(schedule.displayMode))) fail("收起模式无效");
    object(root.settings, "设置");
    return hydrateAppState(root as unknown as Partial<AppState>) || fail("核心字段无效");
  }

  export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  }

  export interface StatePersistence {
    load(): Promise<AppState | null>;
    save(state: AppState): Promise<void>;
    reset(): Promise<void>;
    restore?(state: AppState): Promise<string>;
  }

  export interface LegacyStateCandidate {
    sourceKey: string;
    raw: string;
    state: AppState;
  }

  export interface PersistenceInitialization {
    repository: StatePersistence;
    state: AppState;
    createdFresh: boolean;
    migration?: MigrationOutcome;
  }

  export interface NativeStateClient {
    loadAppState(): Promise<string | null>;
    saveAppState(stateJson: string): Promise<void>;
    resetAppState(): Promise<void>;
    migrateLegacyState(candidate: LegacyStateCandidate): Promise<MigrationOutcome>;
  }

  export const SQLITE_MIGRATION_MARKER_KEY = "tanyue.sqlite.migrated.v1";

  function parseStoredState(raw: string): AppState | null {
    try {
      return hydrateAppState(JSON.parse(raw) as Partial<AppState>);
    } catch {
      return null;
    }
  }

  export function findLegacyState(storage: StorageLike): LegacyStateCandidate | null {
    const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
    for (const sourceKey of keys) {
      const raw = storage.getItem(sourceKey);
      if (!raw) continue;
      const state = parseStoredState(raw);
      if (state) return { sourceKey, raw, state };
    }
    return null;
  }

  export class BrowserLocalStorageRepository implements StatePersistence {
    constructor(private readonly storage: StorageLike) {}

    async load(): Promise<AppState | null> {
      return findLegacyState(this.storage)?.state || null;
    }

    async save(state: AppState): Promise<void> {
      state.lastOpenedAt = new Date().toISOString();
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    async reset(): Promise<void> {
      this.storage.removeItem(STORAGE_KEY);
      LEGACY_STORAGE_KEYS.forEach((key) => this.storage.removeItem(key));
    }

    async restore(state: AppState): Promise<string> {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("无法读取恢复前数据，恢复已取消");
      this.storage.setItem(RESTORE_BACKUP_KEY, raw);
      await this.save(state);
      return "浏览器本地备份（设置页可导出恢复前备份）";
    }
  }

  function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.keys(record).sort().reduce<Record<string, unknown>>((result, key) => {
        result[key] = stableValue(record[key]);
        return result;
      }, {});
    }
    return value;
  }

  function migrationFingerprint(state: AppState): string {
    return JSON.stringify(stableValue({
      books: state.books.map((book) => book.id),
      segments: state.segments.map((segment) => [
        segment.id,
        segment.bookId,
        segment.sequence,
        segment.status,
        segment.favorite,
        segment.note
      ]),
      activeBookId: state.activeBookId,
      currentSegmentId: state.currentSegmentId,
      schedule: state.schedule,
      settings: state.settings
    }));
  }

  export class TauriSqliteRepository implements StatePersistence {
    constructor(
      private readonly storage: StorageLike,
      private readonly client: NativeStateClient = DesktopBridge
    ) {}

    async load(): Promise<AppState | null> {
      const raw = await this.client.loadAppState();
      if (!raw) return null;
      let parsed: Partial<AppState>;
      try {
        parsed = JSON.parse(raw) as Partial<AppState>;
      } catch (error) {
        throw new Error(`SQLite 返回了损坏的状态：${error instanceof Error ? error.message : String(error)}`);
      }
      const state = hydrateAppState(parsed);
      if (!state) throw new Error("SQLite 状态版本或核心字段无效。");
      return state;
    }

    async save(state: AppState): Promise<void> {
      state.lastOpenedAt = new Date().toISOString();
      await this.client.saveAppState(JSON.stringify(state));
    }

    async reset(): Promise<void> {
      await this.client.resetAppState();
    }

    async restore(state: AppState): Promise<string> {
      return DesktopBridge.invokeRequired<string>("restore_app_state", { stateJson: JSON.stringify(state) });
    }

    async initialize(fallback: AppState): Promise<PersistenceInitialization> {
      const existing = await this.load();
      if (existing) return { repository: this, state: existing, createdFresh: false };

      const candidate = findLegacyState(this.storage);
      if (candidate) {
        const migration = await this.client.migrateLegacyState(candidate);
        const migrated = await this.load();
        if (migrated) {
          if (migrationFingerprint(migrated) !== migrationFingerprint(candidate.state)) {
            throw new Error("SQLite 迁移后的书籍、进度、收藏、笔记、计划或设置校验不一致。");
          }
          if (migration.bookCount !== migrated.books.length || migration.segmentCount !== migrated.segments.length) {
            throw new Error("SQLite 迁移计数校验不一致。");
          }
          this.storage.setItem(SQLITE_MIGRATION_MARKER_KEY, JSON.stringify({
            sourceKey: candidate.sourceKey,
            status: migration.status,
            migratedAt: new Date().toISOString(),
            backupPath: migration.backupPath
          }));
          return { repository: this, state: migrated, migration, createdFresh: false };
        }
        if (migration.status !== "already_migrated") {
          throw new Error("SQLite 迁移完成后未能读回状态。");
        }
      }

      const initial = deepClone(fallback);
      await this.save(initial);
      return { repository: this, state: initial, createdFresh: true };
    }
  }

  export async function initializeStatePersistence(
    storage: StorageLike,
    fallback: AppState
  ): Promise<PersistenceInitialization> {
    if (DesktopBridge.isTauri()) {
      return new TauriSqliteRepository(storage).initialize(fallback);
    }
    const repository = new BrowserLocalStorageRepository(storage);
    const existing = await repository.load();
    return {
      repository,
      state: existing || deepClone(fallback),
      createdFresh: !existing
    };
  }

  export class PersistenceCoordinator {
    private pendingState: AppState | null = null;
    private drainPromise: Promise<void> | null = null;

    constructor(
      private readonly repository: StatePersistence,
      private readonly onError?: (error: unknown) => void
    ) {}

    save(state: AppState): Promise<void> {
      // 只保留可变的待保存引用，真正的深拷贝在 drain 即将落盘前执行一次。
      // 这样高频提交（拖动、连续点按）会被合并成一次克隆+序列化，避免每次都在主线程
      // 深拷贝整个状态（几万字的库会阻塞点击线程，造成按钮/弹窗卡顿）。
      this.pendingState = state;
      if (!this.drainPromise) {
        this.drainPromise = this.drain().finally(() => {
          this.drainPromise = null;
        });
      }
      return this.drainPromise;
    }

    async flush(): Promise<void> {
      await this.drainPromise;
    }

    private async drain(): Promise<void> {
      try {
        while (this.pendingState) {
          const snapshot = deepClone(this.pendingState);
          this.pendingState = null;
          await this.repository.save(snapshot);
        }
      } catch (error) {
        this.onError?.(error);
        throw error;
      }
    }
  }
}
