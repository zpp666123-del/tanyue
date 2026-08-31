namespace TanYue {
  export const BUNDLED_SEED_VERSION = 2;
  const DEPRECATED_BUNDLED_BOOK_TITLES = new Set(["毛主席语录（1966年版）"]);

  export interface BundledSeedResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }

  export type BundledSeedFetch = (url: string) => Promise<BundledSeedResponse>;

  interface BundledSeedManifestEntry {
    file: string;
    title: string;
    segmentCount: number;
  }

  interface BundledSeedManifest {
    schemaVersion: 1;
    preferredBookTitle: string;
    totalSegmentCount: number;
    packages: BundledSeedManifestEntry[];
  }

  function parseBundledSeedManifest(raw: string): BundledSeedManifest {
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("内置内容清单不是有效 JSON。");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("内置内容清单格式无效。");
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 1) throw new Error(`不支持的内置内容清单版本：${String(item.schemaVersion)}。`);
    if (typeof item.preferredBookTitle !== "string" || !item.preferredBookTitle.trim()) {
      throw new Error("内置内容清单缺少默认阅读书籍。");
    }
    if (!Number.isSafeInteger(item.totalSegmentCount) || Number(item.totalSegmentCount) < 1) {
      throw new Error("内置内容清单的片段总数无效。");
    }
    if (!Array.isArray(item.packages) || !item.packages.length) throw new Error("内置内容清单没有书籍包。");

    const packages = item.packages.map((entry, index): BundledSeedManifestEntry => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`内置内容清单第 ${index + 1} 项格式无效。`);
      }
      const source = entry as Record<string, unknown>;
      if (typeof source.file !== "string" || !source.file.trim() || source.file.includes("..")) {
        throw new Error(`内置内容清单第 ${index + 1} 项文件名无效。`);
      }
      if (typeof source.title !== "string" || !source.title.trim()) {
        throw new Error(`内置内容清单第 ${index + 1} 项书名无效。`);
      }
      if (!Number.isSafeInteger(source.segmentCount) || Number(source.segmentCount) < 1) {
        throw new Error(`内置内容清单第 ${index + 1} 项片段数无效。`);
      }
      return {
        file: source.file,
        title: source.title,
        segmentCount: Number(source.segmentCount)
      };
    });
    return {
      schemaVersion: 1,
      preferredBookTitle: item.preferredBookTitle.trim(),
      totalSegmentCount: Number(item.totalSegmentCount),
      packages
    };
  }

  function bundledSeedBaseUrl(explicitBaseUrl?: string): string {
    if (explicitBaseUrl) return explicitBaseUrl.endsWith("/") ? explicitBaseUrl : `${explicitBaseUrl}/`;
    const href = typeof location === "undefined" ? "http://localhost/" : location.href;
    return new URL("./seeds/", href).toString();
  }

  export async function installBundledSeeds(
    state: AppState,
    fetchSeed: BundledSeedFetch = (url) => fetch(url),
    baseUrl?: string,
    preserveCurrent = false
  ): Promise<number> {
    const root = bundledSeedBaseUrl(baseUrl);
    const manifestResponse = await fetchSeed(new URL("manifest.json", root).toString());
    if (!manifestResponse.ok) throw new Error(`无法读取内置内容清单（HTTP ${manifestResponse.status}）。`);
    const manifest = parseBundledSeedManifest(await manifestResponse.text());
    const results: ImportResult[] = [];

    for (const entry of manifest.packages) {
      const response = await fetchSeed(new URL(entry.file, root).toString());
      if (!response.ok) throw new Error(`无法读取内置书籍《${entry.title}》（HTTP ${response.status}）。`);
      const result = importAgentPackage(await response.text());
      if (result.book.title !== entry.title) throw new Error(`内置书籍名称不匹配：期望《${entry.title}》。`);
      if (result.segments.length !== entry.segmentCount) {
        throw new Error(`内置书籍《${entry.title}》片段数不匹配。`);
      }
      results.push(result);
    }

    const actualTotal = results.reduce((sum, result) => sum + result.segments.length, 0);
    if (actualTotal !== manifest.totalSegmentCount) throw new Error("内置书籍片段总数与清单不匹配。");
    const previousCurrentSegmentId = state.currentSegmentId;
    const deprecatedBookIds = state.books
      .filter((book) => DEPRECATED_BUNDLED_BOOK_TITLES.has(book.title))
      .map((book) => book.id);
    deprecatedBookIds.forEach((bookId) => removeBook(state, bookId));
    const originalOrder = state.books.map((book) => book.id);
    const importedIds: string[] = [];
    results.forEach((result) => {
      importedIds.push(result.book.id);
      if (!state.books.some((book) => book.id === result.book.id)) {
        addImportedContent(state, result, { activate: false, recordEvent: false });
      }
    });

    if (!preserveCurrent) {
      const order = new Map([...importedIds, ...originalOrder].map((id, index) => [id, index]));
      state.books.sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
      const preferred = state.books.find((book) => book.title === manifest.preferredBookTitle);
      const preferredSegment = preferred ? getBookSegments(state, preferred.id)[0] : null;
      if (preferredSegment) setCurrentSegment(state, preferredSegment.id);
    } else if (state.segments.some((segment) => segment.id === previousCurrentSegmentId)) {
      setCurrentSegment(state, previousCurrentSegmentId);
    }
    state.events = state.events.filter((event) =>
      event.type !== "imported" || !event.bookId || !importedIds.includes(event.bookId)
    );
    state.contentSeedVersion = BUNDLED_SEED_VERSION;
    return results.length;
  }
}
