namespace TanYueTests {
  class MemoryStorage implements TanYue.StorageLike {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
      return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
      this.values.set(key, value);
    }

    removeItem(key: string): void {
      this.values.delete(key);
    }
  }

  test("浏览器仓储完整保存并读取状态", async () => {
    const storage = new MemoryStorage();
    const repository = new TanYue.BrowserLocalStorageRepository(storage);
    const state = TanYue.createDemoState();
    state.segments[0].note = "SQLite 前的浏览器回退测试";

    await repository.save(state);
    const loaded = await repository.load();

    assert(loaded, "应读回已保存状态");
    equal(loaded.segments[0].note, state.segments[0].note, "笔记应完整往返");
    assert(loaded !== state, "读取结果不应复用原对象引用");
  });

  test("损坏的 LocalStorage 不会伪装成有效状态", async () => {
    const storage = new MemoryStorage();
    storage.setItem(TanYue.STORAGE_KEY, "{broken-json");
    const repository = new TanYue.BrowserLocalStorageRepository(storage);

    equal(await repository.load(), null, "损坏状态应返回 null");
    equal(storage.getItem(TanYue.STORAGE_KEY), "{broken-json", "损坏原数据应保留以便恢复");
  });

  test("迁移探测优先当前 key，并为旧片段回填追溯", () => {
    const storage = new MemoryStorage();
    const state = TanYue.createDemoState();
    const legacySegment = { ...state.segments[0] } as Partial<TanYue.Segment>;
    delete legacySegment.sourceRuns;
    delete legacySegment.processingTrace;
    state.segments[0] = legacySegment as TanYue.Segment;
    storage.setItem(TanYue.LEGACY_STORAGE_KEYS[0], JSON.stringify(TanYue.createDemoState()));
    storage.setItem(TanYue.STORAGE_KEY, JSON.stringify(state));

    const candidate = TanYue.findLegacyState(storage);
    assert(candidate, "应找到迁移候选");
    equal(candidate.sourceKey, TanYue.STORAGE_KEY, "应优先当前存储 key");
    equal(candidate.state.segments[0].processingTrace.parserVersion, "legacy-unversioned", "旧片段应回填追溯");
  });

  test("保存协调器串行写入并保证最后状态落盘", async () => {
    const savedNotes: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const repository: TanYue.StatePersistence = {
      load: async () => null,
      save: async (state) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        savedNotes.push(state.segments[0].note);
        concurrent -= 1;
      },
      reset: async () => undefined
    };
    const coordinator = new TanYue.PersistenceCoordinator(repository);
    const state = TanYue.createDemoState();
    state.segments[0].note = "first";
    const first = coordinator.save(state);
    state.segments[0].note = "middle";
    const middle = coordinator.save(state);
    state.segments[0].note = "last";
    const last = coordinator.save(state);

    await Promise.all([first, middle, last]);
    equal(maxConcurrent, 1, "保存不得并发执行");
    equal(savedNotes[savedNotes.length - 1], "last", "最终状态必须落盘");
    assert(savedNotes.length <= 2, "连续待处理状态应合并");
  });

  test("Tauri 仓储首次启动迁移旧状态并保留迁移标记", async () => {
    const storage = new MemoryStorage();
    const legacy = TanYue.createDemoState();
    storage.setItem(TanYue.STORAGE_KEY, JSON.stringify(legacy));
    let databaseJson: string | null = null;
    let migrationCalls = 0;
    const client: TanYue.NativeStateClient = {
      loadAppState: async () => databaseJson,
      saveAppState: async (stateJson) => { databaseJson = stateJson; },
      resetAppState: async () => { databaseJson = null; },
      migrateLegacyState: async (candidate) => {
        migrationCalls += 1;
        databaseJson = JSON.stringify(candidate.state);
        return {
          status: "migrated",
          backupPath: "C:/app-data/backups/localstorage.json",
          bookCount: candidate.state.books.length,
          segmentCount: candidate.state.segments.length
        };
      }
    };
    const repository = new TanYue.TauriSqliteRepository(storage, client);
    const initialized = await repository.initialize(TanYue.createDemoState());

    equal(migrationCalls, 1, "首次启动应执行一次迁移");
    equal(initialized.state.books.length, legacy.books.length, "书籍数量应一致");
    equal(initialized.state.segments.length, legacy.segments.length, "片段数量应一致");
    assert(storage.getItem(TanYue.SQLITE_MIGRATION_MARKER_KEY), "成功后应写迁移标记");
    assert(storage.getItem(TanYue.STORAGE_KEY), "原 LocalStorage 应继续保留");
    equal(initialized.createdFresh, false, "迁移数据不得被当作全新安装");
  });

  test("Tauri 仓储检测迁移后状态不一致", async () => {
    const storage = new MemoryStorage();
    const legacy = TanYue.createDemoState();
    storage.setItem(TanYue.STORAGE_KEY, JSON.stringify(legacy));
    let databaseJson: string | null = null;
    const client: TanYue.NativeStateClient = {
      loadAppState: async () => databaseJson,
      saveAppState: async () => undefined,
      resetAppState: async () => undefined,
      migrateLegacyState: async (candidate) => {
        const damaged = TanYue.deepClone(candidate.state);
        damaged.segments[0].note = "mismatch";
        databaseJson = JSON.stringify(damaged);
        return {
          status: "migrated",
          backupPath: "C:/app-data/backups/localstorage.json",
          bookCount: damaged.books.length,
          segmentCount: damaged.segments.length
        };
      }
    };
    const repository = new TanYue.TauriSqliteRepository(storage, client);

    let failed = false;
    try {
      await repository.initialize(TanYue.createDemoState());
    } catch (error) {
      failed = error instanceof Error && error.message.includes("校验不一致");
    }
    assert(failed, "迁移后内容不一致必须失败");
    equal(storage.getItem(TanYue.SQLITE_MIGRATION_MARKER_KEY), null, "失败迁移不得写完成标记");
  });
}
