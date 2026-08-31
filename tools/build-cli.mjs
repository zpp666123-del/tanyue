import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = join(root, "src-tauri");
const cargoHome = process.platform === "win32" && process.env.USERPROFILE
  ? join(process.env.USERPROFILE, ".cargo", "bin")
  : "";
const executable = (name) => {
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  const fallback = cargoHome ? join(cargoHome, filename) : filename;
  return existsSync(fallback) ? fallback : filename;
};

const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    shell: false
  });
  if (result.error || result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw result.error || new Error(`${command} exited with ${result.status}`);
  }
  return capture ? result.stdout.trim() : "";
};

const cargo = executable("cargo");
const rustc = executable("rustc");
const targetTriple = run(rustc, ["--print", "host-tuple"], true);
const extension = process.platform === "win32" ? ".exe" : "";
const destinationDirectory = join(tauriRoot, "binaries");
const destination = join(destinationDirectory, `tanyue-cli-${targetTriple}${extension}`);
mkdirSync(destinationDirectory, { recursive: true });
// ponytail: Tauri validates externalBin before Cargo can build it, so a zero-byte bootstrap breaks that cycle.
if (!existsSync(destination)) writeFileSync(destination, "");
run(cargo, ["build", "--manifest-path", join(tauriRoot, "Cargo.toml"), "--release", "--bin", "tanyue-cli"]);

const source = join(tauriRoot, "target", "release", `tanyue-cli${extension}`);
copyFileSync(source, destination);
console.log(`✓ Built Agent import CLI at ${destination}`);
