import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, ".build");
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

function run(command, args) {
  const executable = command === "tsc" ? process.execPath : command;
  const commandArgs = command === "tsc" ? [resolve(root, "node_modules", "typescript", "bin", "tsc"), ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(result.error || `${command} exited with ${result.status}`);
    process.exit(result.status || 1);
  }
}

run("tsc", ["-p", "tsconfig.test.json"]);
run(process.execPath, [resolve(buildDir, "tests.js")]);
