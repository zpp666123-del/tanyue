namespace TanYue {
  export type ViewId = "today" | "library" | "plan" | "favorites" | "settings";
  export type ThemeMode = "system" | "light" | "dark";
  export type PopupSizeMode = "adaptive" | "compact" | "small";
  export type BookKind = "classic" | "document" | "article" | "manual";
  export type LibrarySortMode = "recent" | "imported" | "progress" | "title";
  export type SourceFormat = "txt" | "md" | "url" | "pdf" | "docx" | "epub" | "json";
  export type SegmentStatus = "unread" | "shown" | "confirmed";
  export type EventType = "shown" | "confirmed" | "snoozed" | "favorite" | "imported";

  export interface SourceAnchor {
    kind: "chapter" | "line" | "page" | "cfi" | "url";
    value: string;
    label: string;
  }

  export interface SegmentSourceRun {
    blockId: string;
    startOffset: number;
    endOffset: number;
    sourceAnchor: SourceAnchor;
    contentHash: string;
  }

  export interface ProcessingTrace {
    parserId: string;
    parserVersion: string;
    segmenterVersion: string;
    ruleVersion: string;
    aiPromptVersion: string | null;
    aiModel: string | null;
    createdAt: string;
  }

  export interface Segment {
    id: string;
    bookId: string;
    sequence: number;
    chapterTitle: string;
    helperTitle: string;
    originalText: string;
    contextBridge?: string;
    explanation?: string;
    estimatedSeconds: number;
    sourceAnchor: SourceAnchor;
    contentHash: string;
    sourceRuns: SegmentSourceRun[];
    processingTrace: ProcessingTrace;
    status: SegmentStatus;
    favorite: boolean;
    note: string;
    viewCount: number;
    lastShownAt?: string;
    dismissedAt?: string;
    confirmedAt?: string;
  }

  export interface Book {
    id: string;
    title: string;
    author: string;
    kind: BookKind;
    format: SourceFormat;
    sourceName: string;
    sourceUrl?: string;
    sourceHash?: string;
    sourceMediaType?: string;
    description: string;
    accent: string;
    coverStyle: "ink" | "paper" | "forest" | "night" | "sun";
    segmentCount: number;
    totalChars: number;
    currentSequence: number;
    createdAt: string;
    updatedAt: string;
    lastOpenedAt?: string;
    archived: boolean;
  }

  export interface TimeWindow {
    id: string;
    start: string;
    end: string;
    enabled: boolean;
    label: string;
  }

  export interface ReadingSchedule {
    enabled: boolean;
    weekdays: number[];
    dailyCount: number;
    displayMode: "adaptive" | "fixed";
    displaySeconds: number;
    targetSeconds: 30 | 60 | 90;
    windows: TimeWindow[];
    quietStart: string;
    quietEnd: string;
    snoozeUntil?: string;
    pausedUntil?: string;
    nextDueAt?: string;
    lastTriggeredSlot?: string;
  }

  export interface AppSettings {
    theme: ThemeMode;
    autostart: boolean;
    floatingWidget: boolean;
    hoverPausesTimer: boolean;
    reduceMotion: boolean;
    showExplanation: boolean;
    adSkin: boolean;
    nativeNotifications: boolean;
    fontScale: number;
    readingFont: "serif" | "sans";
    popupSizeMode: PopupSizeMode;
  }

  export interface ActivityEvent {
    id: string;
    type: EventType;
    segmentId?: string;
    bookId?: string;
    createdAt: string;
    meta?: Record<string, string | number | boolean>;
  }

  export interface AppState {
    schemaVersion: 1;
    contentSeedVersion: number;
    books: Book[];
    segments: Segment[];
    activeBookId: string;
    currentSegmentId: string;
    schedule: ReadingSchedule;
    settings: AppSettings;
    events: ActivityEvent[];
    selectedView: ViewId;
    lastOpenedAt: string;
    onboardingComplete: boolean;
  }

  export interface DocumentBlock {
    id: string;
    sequence: number;
    type: "heading" | "paragraph" | "list";
    text: string;
    lineStart: number;
    lineEnd: number;
    sourceAnchor: SourceAnchor;
    contentHash: string;
  }

  export interface NormalizedDocument {
    id: string;
    title: string;
    blocks: DocumentBlock[];
    sourceFormat: SourceFormat;
    sourceName: string;
    adapterId: string;
    parserVersion: string;
  }

  export type ParsedDocument = NormalizedDocument;

  export interface TextSourceInput {
    name: string;
    text: string;
  }

  export interface SourceAdapter<Input> {
    readonly id: string;
    readonly version: string;
    detect(input: Input): Promise<number>;
    parse(input: Input): Promise<NormalizedDocument>;
    locate(anchor: SourceAnchor): Promise<SourceAnchor | null>;
    dispose(): Promise<void>;
  }

  export type SourceAdapterErrorCode = "empty_source" | "unsupported_format" | "parse_failed";

  export interface CoverageReport {
    readableBlockCount: number;
    coveredBlockCount: number;
    segmentCount: number;
    coveragePercent: number;
    duplicateRunCount: number;
    gapCount: number;
    outOfOrderCount: number;
    emptySegmentCount: number;
    valid: boolean;
  }

  export interface ImportResult {
    book: Book;
    segments: Segment[];
    coverage: CoverageReport;
    warnings: string[];
  }

  export interface PendingImportPackage {
    id: string;
    json: string;
    error?: string;
  }

  export type ImportPackageErrorCode =
    | "invalid_json"
    | "unsupported_schema"
    | "invalid_package"
    | "invalid_coverage"
    | "package_too_large";

  export interface UpcomingSlot {
    at: Date;
    windowId: string;
    label: string;
    ordinal: number;
  }

  export interface DailySummary {
    shown: number;
    confirmed: number;
    minutes: number;
    favorites: number;
  }

  export interface TauriGlobal {
    core?: { invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T> };
    event?: {
      emit: (event: string, payload?: unknown) => Promise<void>;
      listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
    };
    autostart?: {
      enable: () => Promise<void>;
      disable: () => Promise<void>;
      isEnabled: () => Promise<boolean>;
    };
    notification?: {
      isPermissionGranted: () => Promise<boolean>;
      requestPermission: () => Promise<string>;
      sendNotification: (options: { title: string; body: string }) => void;
    };
    opener?: {
      openUrl: (url: string) => Promise<void>;
      openPath?: (path: string) => Promise<void>;
    };
    app?: {
      getVersion: () => Promise<string>;
    };
    process?: {
      relaunch: () => Promise<void>;
      exit?: (code?: number) => Promise<void>;
    };
    updater?: {
      check: () => Promise<UpdaterUpdate | null>;
    };
  }

  export interface UpdaterProgressEvent {
    event: "Started" | "Progress" | "Finished";
    data: {
      contentLength?: number | null;
      chunkLength?: number;
    };
  }

  export interface UpdaterUpdate {
    version: string;
    currentVersion: string;
    date: string | null;
    notes?: string | null;
    body?: string | null;
    download: (onEvent: (event: UpdaterProgressEvent) => void) => Promise<void>;
    install: () => Promise<void>;
    close: () => Promise<void>;
  }

  export interface MigrationOutcome {
    status: "migrated" | "already_migrated" | "database_not_empty";
    backupPath: string | null;
    bookCount: number;
    segmentCount: number;
  }

  export interface StorageDiagnostics {
    databasePath: string;
    databaseExists: boolean;
    schemaVersion: number;
    bookCount: number;
    segmentCount: number;
    migrationCount: number;
  }
}

interface Window {
  __TAURI__?: TanYue.TauriGlobal;
  TanYueApp?: unknown;
}
