namespace TanYue {
  export const STORAGE_KEY = "tanyue.state.v1";
  export const LEGACY_STORAGE_KEYS = ["shuchuang.state.v1"] as const;
  export const APP_VERSION = "0.2.7";
  export const BRAND = {
    name: "弹阅",
    codeName: "TanYue",
    tagline: "少而精地读，深而静地思。",
    description: "本地优先、安静不打扰的桌面微阅读工具"
  } as const;
  export const READING_FONT_SCALE_MIN = 0.5;
  export const READING_FONT_SCALE_MAX = 1.5;
  export const READING_FONT_SCALE_STEP = 0.05;

  export function uid(prefix = "id"): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  export function normalizeReadingFontScale(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 1;
    const clamped = clamp(numeric, READING_FONT_SCALE_MIN, READING_FONT_SCALE_MAX);
    return Number((Math.round(clamped / READING_FONT_SCALE_STEP) * READING_FONT_SCALE_STEP).toFixed(2));
  }

  export function toFiniteNumber(value: unknown, fallback: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  export function normalizeSchedule(schedule: ReadingSchedule): ReadingSchedule {
    const dailyCount = toFiniteNumber(schedule.dailyCount, 5);
    const displaySeconds = toFiniteNumber(schedule.displaySeconds, 60);
    const rawTarget = toFiniteNumber(schedule.targetSeconds, 60);
    const targetSeconds: 30 | 60 | 90 =
      rawTarget === 30 || rawTarget === 60 || rawTarget === 90 ? rawTarget : 60;
    return { ...schedule, dailyCount, displaySeconds, targetSeconds };
  }

  export function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
    // 只保留当前版本真正使用的设置字段，并规范化类型。
    // 旧版本遗留的假设置（closeToTray / aiEnabled / pauseFullscreen 等）会被丢弃，
    // 避免脏字段在迁移后继续残留、也避免 UI 读出已移除的开关。
    const theme: ThemeMode = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system";
    const readingFont: "serif" | "sans" = raw.readingFont === "sans" ? "sans" : "serif";
    const popupSizeMode: PopupSizeMode =
      raw.popupSizeMode === "compact" || raw.popupSizeMode === "small" ? raw.popupSizeMode : "adaptive";
    return {
      theme,
      autostart: raw.autostart === true,
      floatingWidget: raw.floatingWidget !== false,
      hoverPausesTimer: raw.hoverPausesTimer !== false,
      reduceMotion: raw.reduceMotion === true,
      showExplanation: raw.showExplanation !== false,
      adSkin: raw.adSkin === true,
      nativeNotifications: raw.nativeNotifications === true,
      fontScale: normalizeReadingFontScale(raw.fontScale),
      readingFont,
      popupSizeMode
    };
  }

  export function readingFontScaleProgress(value: unknown): number {
    const scale = normalizeReadingFontScale(value);
    return Math.round(((scale - READING_FONT_SCALE_MIN) / (READING_FONT_SCALE_MAX - READING_FONT_SCALE_MIN)) * 100);
  }

  export function readingBodyLineHeight(value: unknown): number {
    const scale = normalizeReadingFontScale(value);
    return Number(clamp(1.8 - (scale - 1) * 0.28, 1.66, 1.92).toFixed(2));
  }

  export function readingLayoutDensity(value: unknown): number {
    const scale = normalizeReadingFontScale(value);
    return Number(clamp(0.5 + scale * 0.5, 0.75, 1).toFixed(2));
  }

  function baseChapterTitle(value: string): string {
    return value.trim().replace(/\s+[·•]\s+\d+\s*$/, "");
  }

  function comparableReadingTitle(value: string): string {
    return value
      .toLocaleLowerCase("zh-CN")
      .replace(/[\s《》〈〉「」『』【】（）()·•：:,，。.!！?？—–_-]+/g, "");
  }

  export function readingHeadingForSegment(state: AppState, segment: Segment): string | null {
    const book = state.books.find((item) => item.id === segment.bookId);
    if (!book) return null;

    const title = baseChapterTitle(segment.chapterTitle);
    if (!title || comparableReadingTitle(title) === comparableReadingTitle(book.title)) return null;
    if (/^(未命名章节|正文(?:内容)?|开篇|继续|第\s*[0-9一二三四五六七八九十百千〇零两]+\s*段)$/.test(title)) return null;
    if (segment.sourceAnchor.kind !== "chapter"
      && comparableReadingTitle(title) === comparableReadingTitle(segment.sourceAnchor.label)) return null;

    const appearedEarlier = state.segments.some((item) => item.bookId === segment.bookId
      && item.sequence < segment.sequence
      && comparableReadingTitle(baseChapterTitle(item.chapterTitle)) === comparableReadingTitle(title));
    if (appearedEarlier) return null;

    const originalStart = comparableReadingTitle(segment.originalText.trimStart());
    if (originalStart.startsWith(comparableReadingTitle(title))) return null;
    return title;
  }

  export function pad2(value: number): string {
    return String(value).padStart(2, "0");
  }

  export function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  export function isoAtToday(hours: number, minutes: number, dayOffset = 0): string {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  }

  export function formatDate(date: Date): string {
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
    return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`;
  }

  export function formatTime(date: Date): string {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  export function formatRelativeTime(target: Date, now = new Date()): string {
    const diff = Math.max(0, target.getTime() - now.getTime());
    const minutes = Math.floor(diff / 60000);
    if (minutes <= 0) return "即将出现";
    if (minutes < 60) return `${minutes} 分钟后`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分后` : `${hours} 小时后`;
  }

  export function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  }

  export function escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  export function bookCoverTitleLines(title: string): string[] {
    const cleaned = title
      .trim()
      .replace(/[《》〈〉「」『』【】]/g, "")
      .replace(/\s*[（(][^（）()]{0,24}[）)]\s*$/, "")
      .replace(/\s+/g, "");
    const characters = Array.from(cleaned || "未命名");
    const volume = cleaned.match(/^(.*?)(第[0-9一二三四五六七八九十百千〇零两]+卷)$/);
    if (volume) return [volume[1], volume[2]];
    if (characters.length <= 5) return [characters.join("")];
    const first = characters.slice(0, 5).join("");
    const remainder = characters.slice(5);
    const second = remainder.length > 5
      ? `${remainder.slice(0, 4).join("")}…`
      : remainder.join("");
    return [first, second];
  }

  export function hashText(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  export function createLegacySegmentMetadata(
    segmentId: string,
    originalText: string,
    sourceAnchor: SourceAnchor,
    createdAt = new Date().toISOString()
  ): Pick<Segment, "sourceRuns" | "processingTrace"> {
    return {
      sourceRuns: [{
        blockId: `${segmentId}_legacy_block`,
        startOffset: 0,
        endOffset: originalText.length,
        sourceAnchor,
        contentHash: hashText(originalText)
      }],
      processingTrace: {
        parserId: "legacy-unversioned",
        parserVersion: "legacy-unversioned",
        segmenterVersion: "legacy-unversioned",
        ruleVersion: "legacy-unversioned",
        aiPromptVersion: null,
        aiModel: null,
        createdAt
      }
    };
  }

  export function countReadableChars(text: string): number {
    return text.replace(/\s+/g, "").length;
  }

  export function estimateReadingSeconds(text: string): number {
    const compact = text.trim();
    const cjk = (compact.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latinWords = (compact.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    const punctuationPauses = (compact.match(/[。！？；：.!?;:]/g) || []).length;
    const raw = cjk / 5.3 + latinWords / 3.2 + punctuationPauses * 0.32;
    return clamp(Math.round(raw), 8, 180);
  }

  export function firstSentence(text: string, max = 54): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    const match = normalized.match(/^(.{8,}?[。！？!?])/);
    const sentence = match?.[1] || normalized;
    return sentence.length > max ? `${sentence.slice(0, max)}…` : sentence;
  }

  export function toMinutes(value: string): number {
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
    return hours * 60 + minutes;
  }

  export function fromMinutes(value: number): string {
    const normalized = ((value % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
  }

  export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  export function queryParam(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
  }

  export function isPopupMode(): boolean {
    return queryParam("mode") === "popup";
  }

  export function isFloatingMode(): boolean {
    return queryParam("mode") === "floating";
  }

  export function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  export function mergeDefined<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
    const result = { ...base };
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    });
    return result;
  }

  export function safeUrl(value: string): string | null {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
}
