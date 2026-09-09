namespace TanYue {
  export type UpdatePhase =
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "error";

  export interface UpdateUiState {
    phase: UpdatePhase;
    currentVersion: string | null;
    announcement: UpdateAnnouncement | null;
    progress: UpdateDownloadProgress | null;
    error: string | null;
  }

  export type UpdateUiAction =
    | { type: "fill-version"; version: string | null }
    | { type: "check-start" }
    | { type: "check-done-none" }
    | { type: "check-done-found"; announcement: UpdateAnnouncement }
    | { type: "check-failed"; message: string }
    | { type: "download-start" }
    | { type: "download-progress"; progress: UpdateDownloadProgress }
    | { type: "download-done" }
    | { type: "download-failed"; message: string }
    | { type: "unsupported" };

  export function createInitialUpdateUi(): UpdateUiState {
    return {
      phase: "idle",
      currentVersion: null,
      announcement: null,
      progress: null,
      error: null
    };
  }

  /**
   * 「检查更新」瞬时交互状态的纯转移函数：不进 AppState、不持久化，
   * 只描述设置页关于与更新区块的可见阶段。
   */
  export function reduceUpdateUi(state: UpdateUiState, action: UpdateUiAction): UpdateUiState {
    switch (action.type) {
      case "fill-version":
        return { ...state, currentVersion: action.version };
      case "check-start":
        return {
          ...state,
          phase: "checking",
          announcement: null,
          progress: null,
          error: null
        };
      case "check-done-none":
        return { ...state, phase: "up-to-date", announcement: null };
      case "check-done-found":
        return { ...state, phase: "available", announcement: action.announcement };
      case "check-failed":
        return { ...state, phase: "error", error: action.message };
      case "download-start":
        return {
          ...state,
          phase: "downloading",
          progress: { downloaded: 0, total: null, percent: 0 },
          error: null
        };
      case "download-progress":
        return { ...state, phase: "downloading", progress: action.progress };
      case "download-done":
        return { ...state, phase: "ready", progress: { downloaded: state.progress?.downloaded || 0, total: state.progress?.total ?? null, percent: 100 } };
      case "download-failed":
        return { ...state, phase: "error", error: action.message };
      case "unsupported":
        return {
          ...state,
          phase: "error",
          error: "请使用桌面安装版检查更新（浏览器预览不支持联网更新）。"
        };
      default:
        return state;
    }
  }

  export function formatDownloadSize(bytes: number): string {
    if (bytes <= 0) return "0 MB";
    const megabytes = bytes / (1024 * 1024);
    return megabytes < 1 ? `${Math.max(bytes, 1) / 1024} KB` : `${megabytes.toFixed(1)} MB`;
  }
}
