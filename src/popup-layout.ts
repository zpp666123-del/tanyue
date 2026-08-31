namespace TanYue {
  export const POPUP_MIN_WIDTH = 480;
  export const POPUP_MAX_WIDTH = 600;
  export const POPUP_MIN_HEIGHT = 340;
  export const POPUP_MAX_HEIGHT = 720;
  const POPUP_SCREEN_MARGIN = 96;

  export interface PopupSizeLimits {
    maxWidth: number;
    maxHeight: number;
  }

  export function popupSizeLimits(mode: PopupSizeMode): PopupSizeLimits {
    if (mode === "small") return { maxWidth: 480, maxHeight: 460 };
    if (mode === "compact") return { maxWidth: 520, maxHeight: 560 };
    return { maxWidth: POPUP_MAX_WIDTH, maxHeight: POPUP_MAX_HEIGHT };
  }

  export function popupDisplayUnits(text: string): number {
    return Array.from(text.trim()).reduce((total, character) => {
      if (/\s/u.test(character)) return total + 0.2;
      if (/\p{Script=Han}/u.test(character)) return total + 1;
      return total + 0.55;
    }, 0);
  }

  export function popupWidthForText(text: string, mode: PopupSizeMode = "adaptive", fontScale = 1): number {
    const units = popupDisplayUnits(text);
    const idealWidth = units <= 90 ? POPUP_MIN_WIDTH : units <= 200 ? 540 : POPUP_MAX_WIDTH;
    const largeTextAllowance = mode === "adaptive"
      ? Math.max(0, normalizeReadingFontScale(fontScale) - 1) * 120
      : 0;
    return Math.round(Math.min(idealWidth + largeTextAllowance, popupSizeLimits(mode).maxWidth));
  }

  export function popupHeightForContent(
    contentHeight: number,
    availableHeight: number,
    mode: PopupSizeMode = "adaptive"
  ): number {
    const screenLimit = Math.max(POPUP_MIN_HEIGHT, availableHeight - POPUP_SCREEN_MARGIN);
    const maximum = Math.min(popupSizeLimits(mode).maxHeight, screenLimit);
    return Math.round(clamp(Math.ceil(contentHeight), POPUP_MIN_HEIGHT, maximum));
  }

  export function countdownProgressPercent(remainingSeconds: number, durationSeconds: number): number {
    if (!Number.isFinite(remainingSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
    return clamp((remainingSeconds / durationSeconds) * 100, 0, 100);
  }
}
