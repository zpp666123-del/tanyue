import { createReadStream, existsSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(readArg("--port", "1420"));
const root = process.cwd();
const directory = resolve(root, readArg("--dir", "dist"));
const shouldOpen = args.includes("--open");
const shouldWatch = args.includes("--watch");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

let building = false;
let rebuildQueued = false;
let rebuildTimer;

function runBuild() {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  console.log("\n正在构建弹阅前端……");
  const result = spawnSync(process.execPath, [join(root, "tools", "build.mjs")], {
    cwd: root,
    stdio: "inherit"
  });
  building = false;
  if (result.status !== 0) console.error("构建失败；修复错误后保存文件会自动重试。\n");
  else console.log("构建完成；刷新页面即可看到最新结果。\n");
  if (rebuildQueued) {
    rebuildQueued = false;
    runBuild();
  }
}

function scheduleBuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(runBuild, 180);
}

if (shouldWatch) runBuild();
if (!existsSync(join(directory, "index.html"))) {
  console.error(`未找到 ${join(directory, "index.html")}。请先运行 npm run build。`);
  process.exit(1);
}

const server = createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  let filePath = normalize(join(directory, relative));
  if (!filePath.startsWith(directory)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(directory, "index.html");
  response.setHeader("Content-Type", mime[extname(filePath)] || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(filePath).on("error", () => response.writeHead(404).end("Not found")).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`弹阅开发预览：${url}`);
  if (shouldWatch) console.log("正在监听 src/ 与 public/，保存文件后会自动重新构建。 ");
  if (shouldOpen) {
    const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    spawn(command, commandArgs, { detached: true, stdio: "ignore" }).unref();
  }
});

if (shouldWatch) {
  for (const relativePath of ["src", "public"]) {
    const watchedPath = join(root, relativePath);
    if (!existsSync(watchedPath)) continue;
    try {
      watch(watchedPath, { recursive: true }, (_event, filename) => {
        if (!filename || filename.includes(".DS_Store")) return;
        scheduleBuild();
      });
    } catch (error) {
      console.warn(`无法递归监听 ${relativePath}：`, error.message);
      watch(watchedPath, scheduleBuild);
    }
  }
}

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
