import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function run(command, args) {
  const executable = command === "tsc" ? process.execPath : command;
  const commandArgs = command === "tsc" ? [resolve(root, "node_modules", "typescript", "bin", "tsc"), ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: root, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) {
    console.error(result.error || `${command} exited with ${result.status}`);
    process.exit(result.status || 1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
run("tsc", ["-p", "tsconfig.json"]);
copyFileSync(join(root, "src", "index.html"), join(dist, "index.html"));
copyFileSync(join(root, "src", "styles.css"), join(dist, "styles.css"));
copyFileSync(join(root, "src", "apple.css"), join(dist, "apple.css"));
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), dist, { recursive: true });
if (existsSync(join(root, "docs", "screenshots"))) cpSync(join(root, "docs", "screenshots"), join(dist, "screenshots"), { recursive: true });
writeFileSync(join(dist, "build-info.json"), JSON.stringify({
  name: "弹阅",
  version: packageJson.version,
  builtAt: new Date().toISOString(),
  mode: "static-and-tauri"
}, null, 2));
console.log(`\n✓ Built static application at ${dist}`);
