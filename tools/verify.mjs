import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (label, command, args) => {
  console.log(`\n[verify] ${label}`);
  const executable = command === "tsc" ? process.execPath : command;
  const commandArgs = command === "tsc" ? [resolve(root, "node_modules", "typescript", "bin", "tsc"), ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(`[verify] ${label} failed`, result.error || `exit ${result.status}`);
    process.exit(result.status || 1);
  }
};

run("typecheck", "tsc", ["-p", "tsconfig.json", "--noEmit"]);
run("tests", process.execPath, [resolve(root, "tools", "test.mjs")]);
run("build", process.execPath, [resolve(root, "tools", "build.mjs")]);

console.log("\n[verify] artifacts");

const required = [
  "dist/index.html", "dist/app.js", "dist/styles.css", "dist/apple.css",
  "src/floating.ts", "src/apple.css", "src/popup-layout.ts", "tests/popup-layout.test.ts",
  "src/source-adapter.ts", "src/text-source-adapter.ts",
  "src/import-package.ts", "tests/import-package.test.ts", "public/tanyue-import.schema.json",
  "public/examples/agent-import-example.tanyue.json", "tools/build-cli.mjs", "tools/run-tauri.mjs",
  "src/persistence.ts", "tests/persistence.test.ts",
  "package-lock.json", "specs/windows-import-foundation/requirements.md",
  "specs/windows-import-foundation/design.md", "specs/windows-import-foundation/tasks.md",
  "specs/installable-windows-mvp/requirements.md", "specs/installable-windows-mvp/design.md",
  "specs/installable-windows-mvp/tasks.md", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json", "src-tauri/src/lib.rs", "src-tauri/src/state_repository.rs",
  "src-tauri/icons/icon.ico", "src-tauri/icons/icon.icns",
  "README.md", "docs/01-产品方案总纲.md", "docs/06-交给本地AI的接力提示词.md",
  "docs/09-演示数据来源与校勘说明.md", "docs/10-弹阅v0.2极简UI与悬浮图标.md",
  "docs/screenshots-v0.2/tanyue-main.png", "docs/screenshots-v0.2/tanyue-popup.png",
  "docs/screenshots-v0.2/tanyue-floating.png", "docs/screenshots-v0.2/tanyue-reader.png",
  "public/data/道德经-完整81章.txt"
];
for (const relative of required) {
  const absolute = resolve(root, relative);
  if (!existsSync(absolute) || statSync(absolute).size === 0) {
    console.error(`Missing required artifact: ${relative}`);
    process.exit(1);
  }
}

const html = readFileSync(resolve(root, "dist/index.html"), "utf8");
if (!["app.js", "styles.css", "apple.css"].every((asset) => html.includes(asset))) {
  console.error("Built HTML does not reference all bundled assets.");
  process.exit(1);
}

const compiled = readFileSync(resolve(root, "dist/app.js"), "utf8");
for (const token of [
  "弹阅", "FloatingWidgetController", "floating-widget-shell", "读完下一段", "open-reader-request",
  "open-home-request", 'data-popup-action="open-home"', "打开弹阅首页",
  "当前片段预计阅读", "按正文长度估算，与弹窗同步", "新内容每段目标时长",
  "调整时弹窗即时变化", "reading-appearance-preview", "normalizeReadingFontScale",
  "readingBodyLineHeight", "readingLayoutDensity", "readingHeadingForSegment", "极小 50%",
  "sortBooksForLibrary", "最近阅读", "library-current-badge",
  "resumeSegmentForBook", "选择章节或片段", "接续位置", "选择阅读位置",
  "PlainTextSourceAdapter", "createCoverageReport", "processingTrace", "PersistenceCoordinator",
  "migrateLegacyState", "storageDiagnostics", "importAgentPackage", "listPendingImportPackages"
]) {
  if (!compiled.includes(token)) {
    console.error(`Compiled application is missing expected feature token: ${token}`);
    process.exit(1);
  }
}
if (compiled.includes("floating-badge") || compiled.includes("floating-ready")) {
  console.error("Compiled floating widget still contains an ambiguous status badge.");
  process.exit(1);
}

const popupCss = readFileSync(resolve(root, "dist/apple.css"), "utf8");
for (const token of [
  "body.popup-window .reading-popup-layer { padding: 0; place-items: stretch; }",
  "grid-template-columns: repeat(4,minmax(0,1fr))",
  "height: 100vh",
  ".floating-orb {\n  width: 48px;\n  height: 48px;",
  ".page.minimal-today { width: 100%; max-width: none; margin: 0;",
  ".view-host { height: calc(100vh - 76px); min-height: 0; overflow-x: hidden; overflow-y: auto;"
]) {
  if (!popupCss.includes(token)) {
    console.error(`Built popup CSS is missing compact-layout token: ${token}`);
    process.exit(1);
  }
}

const baseCss = readFileSync(resolve(root, "dist/styles.css"), "utf8");
for (const token of [
  "body.popup-window #toast-host { right: 12px; bottom: 62px;",
  ".toast.toast-compact { min-width: 0; max-width: 180px; min-height: 28px;"
]) {
  if (!baseCss.includes(token)) {
    console.error(`Built base CSS is missing compact-toast token: ${token}`);
    process.exit(1);
  }
}
for (const token of ["page-in", "translateY(-1px)", "button:active { transform: scale"]) {
  if (baseCss.includes(token) || popupCss.includes(token)) {
    console.error(`Built UI still contains a high-frequency movement token: ${token}`);
    process.exit(1);
  }
}

const rust = readFileSync(resolve(root, "src-tauri", "src", "lib.rs"), "utf8");
for (const token of [
  ".visible(false)", "if reveal {", "const FLOATING_WIDTH: f64 = 52.0;",
  "const WINDOW_GAP: f64 = 4.0;", "struct WindowCoordinator", "popup_anchor.take()",
  "WindowEvent::Moved", "sync_popup_to_floating", "floating_position_for_popup"
]) {
  if (!rust.includes(token)) {
    console.error(`Tauri popup lifecycle is missing token: ${token}`);
    process.exit(1);
  }
}
for (const command of [
  "show_reading_popup", "show_floating_widget", "hide_floating_widget", "load_app_state",
  "fit_reading_popup", "move_reading_popup", "start_floating_widget_drag", "save_app_state", "migrate_legacy_state",
  "reset_app_state", "storage_diagnostics", "list_pending_import_packages", "acknowledge_import_package"
]) {
  if (!rust.includes(command)) {
    console.error(`Tauri source is missing command: ${command}`);
    process.exit(1);
  }
}

const showPopupSource = rust.slice(
  rust.indexOf("async fn show_reading_popup"),
  rust.indexOf("async fn hide_reading_popup")
);
if (showPopupSource.includes("floating.hide()")) {
  console.error("Opening the reading popup must keep the floating widget visible.");
  process.exit(1);
}

const appSource = readFileSync(resolve(root, "src", "app.ts"), "utf8");
if (!appSource.includes('if (isPopupMode()) {\n        document.body.innerHTML = "";\n        this.bindGlobalEvents();\n        await this.setupDesktopListeners();')) {
  console.error("Standalone reading popup must subscribe to cross-window state before rendering.");
  process.exit(1);
}
if (!appSource.includes("view && view !== this.state.selectedView")
  || !appSource.includes("previousView === this.state.selectedView")) {
  console.error("Main navigation must avoid no-op rerenders and preserve in-view scroll position.");
  process.exit(1);
}
if (!appSource.includes("activeReaderSegmentId")
  || !appSource.includes("openReaderFromExternalRequest")
  || !appSource.includes("if (this.activeReaderSegmentId) this.openReader(this.activeReaderSegmentId, true);")) {
  console.error("Main-window rerenders must preserve an active continuous-reader surface.");
  process.exit(1);
}

const popupSource = readFileSync(resolve(root, "src", "popup.ts"), "utf8");
const viewsSource = readFileSync(resolve(root, "src", "views.ts"), "utf8");
if (popupSource.includes("segment.contextBridge ?") || viewsSource.includes("segment.contextBridge ?")) {
  console.error("Reading surfaces must not render canned context bridge copy.");
  process.exit(1);
}
if (popupSource.includes("<h1>${escapeHtml(segment.helperTitle)}</h1>")
  || viewsSource.includes("<h1>${escapeHtml(segment.helperTitle)}</h1>")) {
  console.error("Reading surfaces must not present derived helper text as a source title.");
  process.exit(1);
}
const openReaderActionSource = popupSource.slice(
  popupSource.indexOf('if (action === "open-reader")'),
  popupSource.indexOf("private startTimer")
);
if (openReaderActionSource.includes("emitStateChanged")
  || openReaderActionSource.includes("showMainWindow")) {
  console.error("Popup reader transition must be owned by the main window without duplicate state or visibility events.");
  process.exit(1);
}

console.log("✓ Project verification passed");
