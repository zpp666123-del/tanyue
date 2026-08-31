namespace TanYue {
  export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  }

  export interface StatePersistence {
    load(): Promise<AppState | null>;
    save(state: AppState): Promise<void>;
    reset(): Promise<void>;
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
      this.pendingState = deepClone(state);
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
          const state = this.pendingState;
          this.pendingState = null;
          await this.repository.save(state);
        }
      } catch (error) {
        this.onError?.(error);
        throw error;
      }
    }
  }
}
