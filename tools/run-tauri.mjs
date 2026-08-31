import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoBin = process.platform === "win32" && process.env.USERPROFILE
  ? join(process.env.USERPROFILE, ".cargo", "bin")
  : "";
const pathValue = cargoBin && existsSync(cargoBin)
  ? `${cargoBin}${delimiter}${process.env.PATH || ""}`
  : process.env.PATH;
const result = spawnSync(
  process.execPath,
  [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit", shell: false, env: { ...process.env, PATH: pathValue } }
);
if (result.error || result.status !== 0) {
  console.error(result.error || `tauri exited with ${result.status}`);
  process.exit(result.status || 1);
}
