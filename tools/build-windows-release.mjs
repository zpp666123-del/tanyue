import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const tauriArgs = [join(root, "tools", "run-tauri.mjs"), "build"];
const thumbprint = (process.env.TANYUE_SIGN_CERT_SHA1 || "").replace(/\s+/g, "").toUpperCase();

if (thumbprint) {
  tauriArgs.push("--config", JSON.stringify({
    bundle: {
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: "sha256",
        timestampUrl: process.env.TANYUE_SIGN_TIMESTAMP_URL || "http://timestamp.digicert.com",
        tsp: false
      }
    }
  }));
  console.log(`[release] 将使用证书 ${thumbprint} 对 Windows 产物签名。`);
} else {
  console.warn("[release] 未设置 TANYUE_SIGN_CERT_SHA1，本次生成未签名安装包和 SHA-256 校验文件。");
}

const build = spawnSync(process.execPath, tauriArgs, { cwd: root, stdio: "inherit", shell: false });
if (build.error || build.status !== 0) process.exit(build.status || 1);

const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const builtName = readdirSync(nsisDir).find((name) => name.includes(version) && name.endsWith("_x64-setup.exe"));
if (!builtName) throw new Error(`没有找到 ${version} 的 NSIS 安装包。`);
const builtPath = join(nsisDir, builtName);
const releaseDir = join(root, "release");
const releaseName = `弹阅_${version}_x64-setup.exe`;
const releasePath = join(releaseDir, releaseName);
mkdirSync(releaseDir, { recursive: true });
copyFileSync(builtPath, releasePath);

const sha256 = createHash("sha256").update(readFileSync(releasePath)).digest("hex");
writeFileSync(`${releasePath}.sha256`, `${sha256}  ${releaseName}\n`, "utf8");

let signatureStatus = thumbprint ? "Unknown" : "NotSigned";
if (thumbprint && process.platform === "win32") {
  const escaped = releasePath.replace(/'/g, "''");
  const check = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-AuthenticodeSignature -LiteralPath '${escaped}').Status`
  ], { cwd: root, encoding: "utf8", shell: false });
  signatureStatus = (check.stdout || "").trim() || "Unknown";
}

console.log(`[release] 安装包：${releasePath}`);
console.log(`[release] SHA-256：${sha256}`);
console.log(`[release] Authenticode：${signatureStatus}`);
if (process.env.TANYUE_REQUIRE_SIGNATURE === "1" && signatureStatus !== "Valid") {
  throw new Error("发布要求可信签名，但当前安装包签名无效或不存在。");
}
