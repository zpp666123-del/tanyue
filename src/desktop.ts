namespace TanYue {
  export function shouldHandleStateChanged(payload: unknown, ownInstanceId: string): boolean {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
    const source = (payload as { source?: unknown }).source;
    return typeof source !== "string" || source !== ownInstanceId;
  }

  export class DesktopBridge {
    private static readonly instanceId = globalThis.crypto?.randomUUID?.()
      || `window-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    static isTauri(): boolean {
      return Boolean(window.__TAURI__?.core?.invoke);
    }

    static async invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | null> {
      try {
        if (!window.__TAURI__?.core?.invoke) return null;
        return await window.__TAURI__.core.invoke<T>(command, args);
      } catch (error) {
        console.warn(`Tauri command failed: ${command}`, error);
        return null;
      }
    }

    static async invokeRequired<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error("Tauri runtime is unavailable.");
      return invoke<T>(command, args);
    }

    static loadAppState(): Promise<string | null> {
      return this.invokeRequired<string | null>("load_app_state");
    }

    static saveAppState(stateJson: string): Promise<void> {
      return this.invokeRequired<void>("save_app_state", { stateJson });
    }

    static resetAppState(): Promise<void> {
      return this.invokeRequired<void>("reset_app_state");
    }

    static migrateLegacyState(candidate: LegacyStateCandidate): Promise<MigrationOutcome> {
      return this.invokeRequired<MigrationOutcome>("migrate_legacy_state", {
        sourceKey: candidate.sourceKey,
        originalStateJson: candidate.raw,
        normalizedStateJson: JSON.stringify(candidate.state)
      });
    }

    static storageDiagnostics(): Promise<StorageDiagnostics> {
      return this.invokeRequired<StorageDiagnostics>("storage_diagnostics");
    }

    static listPendingImportPackages(): Promise<PendingImportPackage[]> {
      return this.invokeRequired<PendingImportPackage[]>("list_pending_import_packages");
    }

    static acknowledgeImportPackage(id: string, accepted: boolean, reason?: string): Promise<boolean> {
      return this.invokeRequired<boolean>("acknowledge_import_package", { id, accepted, reason });
    }

    static async showReadingPopup(): Promise<boolean> {
      const result = await this.invoke<boolean>("show_reading_popup");
      return Boolean(result);
    }

    static async hideReadingPopup(): Promise<void> {
      await this.invoke("hide_reading_popup");
    }

    static async fitReadingPopup(width: number, height: number, anchorToFloating: boolean, reveal = false): Promise<boolean> {
      const result = await this.invoke<boolean>("fit_reading_popup", { width, height, anchorToFloating, reveal });
      return Boolean(result);
    }

    static async moveReadingPopup(x: number, y: number): Promise<boolean> {
      const result = await this.invoke<boolean>("move_reading_popup", { x, y });
      return Boolean(result);
    }

    static async startFloatingWidgetDrag(): Promise<boolean> {
      const result = await this.invoke<boolean>("start_floating_widget_drag");
      return Boolean(result);
    }

    static async showMainWindow(): Promise<void> {
      await this.invoke("show_main_window");
    }

    static async setFloatingWidget(visible: boolean): Promise<boolean> {
      const result = await this.invoke<boolean>(visible ? "show_floating_widget" : "hide_floating_widget");
      return Boolean(result);
    }

    static async setAutostart(enabled: boolean): Promise<boolean> {
      try {
        const api = window.__TAURI__?.autostart;
        if (!api) return false;
        if (enabled) await api.enable();
        else await api.disable();
        return await api.isEnabled();
      } catch (error) {
        console.warn("Autostart operation failed", error);
        return false;
      }
    }

    static async getAutostart(): Promise<boolean | null> {
      try {
        return window.__TAURI__?.autostart ? await window.__TAURI__.autostart.isEnabled() : null;
      } catch {
        return null;
      }
    }

    static async notify(title: string, body: string): Promise<boolean> {
      try {
        const api = window.__TAURI__?.notification;
        if (!api) return false;
        let granted = await api.isPermissionGranted();
        if (!granted) granted = (await api.requestPermission()) === "granted";
        if (!granted) return false;
        api.sendNotification({ title, body });
        return true;
      } catch (error) {
        console.warn("Native notification failed", error);
        return false;
      }
    }

    static async openUrl(url: string): Promise<void> {
      const safe = safeUrl(url);
      if (!safe) return;
      try {
        if (window.__TAURI__?.opener?.openUrl) await window.__TAURI__.opener.openUrl(safe);
        else window.open(safe, "_blank", "noopener,noreferrer");
      } catch {
        window.open(safe, "_blank", "noopener,noreferrer");
      }
    }

    static async emitStateChanged(): Promise<void> {
      try {
        await window.__TAURI__?.event?.emit("reading-state-changed", {
          at: Date.now(),
          source: this.instanceId
        });
      } catch {
        // Browser mode intentionally ignores desktop events.
      }
    }

    static async listenStateChanged(handler: () => void): Promise<() => void> {
      try {
        if (!window.__TAURI__?.event?.listen) return () => undefined;
        return await window.__TAURI__.event.listen("reading-state-changed", (event) => {
          if (shouldHandleStateChanged(event.payload, this.instanceId)) handler();
        });
      } catch {
        return () => undefined;
      }
    }

    static async emitReadingAppearancePreview(fontScale: number): Promise<void> {
      try {
        await window.__TAURI__?.event?.emit("reading-appearance-preview", {
          fontScale: normalizeReadingFontScale(fontScale),
          source: this.instanceId
        });
      } catch {
        // Browser mode updates the current document directly.
      }
    }

    static async listenReadingAppearancePreview(handler: (fontScale: number) => void): Promise<() => void> {
      try {
        if (!window.__TAURI__?.event?.listen) return () => undefined;
        return await window.__TAURI__.event.listen("reading-appearance-preview", (event) => {
          if (!shouldHandleStateChanged(event.payload, this.instanceId)) return;
          const fontScale = (event.payload as { fontScale?: unknown } | null)?.fontScale;
          if (typeof fontScale === "number" && Number.isFinite(fontScale)) {
            handler(normalizeReadingFontScale(fontScale));
          }
        });
      } catch {
        return () => undefined;
      }
    }

    static async requestOpenReader(segmentId: string): Promise<void> {
      try {
        await window.__TAURI__?.event?.emit("open-reader-request", { segmentId });
      } catch {
        // Browser preview has no cross-window event bus.
      }
    }

    static async requestOpenHome(): Promise<void> {
      try {
        await window.__TAURI__?.event?.emit("open-home-request");
      } catch {
        // Browser preview has no cross-window event bus.
      }
    }

    static async listenOpenHome(handler: () => void): Promise<() => void> {
      try {
        if (!window.__TAURI__?.event?.listen) return () => undefined;
        return await window.__TAURI__.event.listen("open-home-request", handler);
      } catch {
        return () => undefined;
      }
    }

    static async listenOpenReader(handler: (segmentId: string) => void): Promise<() => void> {
      try {
        if (!window.__TAURI__?.event?.listen) return () => undefined;
        return await window.__TAURI__.event.listen("open-reader-request", (event) => {
          const payload = event.payload as { segmentId?: unknown } | null;
          if (payload && typeof payload.segmentId === "string") handler(payload.segmentId);
        });
      } catch {
        return () => undefined;
      }
    }

    static async listenTrayActions(handler: (action: string) => void): Promise<() => void> {
      try {
        if (!window.__TAURI__?.event?.listen) return () => undefined;
        return await window.__TAURI__.event.listen("tray-action", (event) => {
          if (typeof event.payload === "string") handler(event.payload);
        });
      } catch {
        return () => undefined;
      }
    }
  }
}
