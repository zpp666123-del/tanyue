import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

/**
 * 弹阅更新发布脚本。
 *
 * 用法：
 *   node tools/publish-updates.mjs                         # dry-run：生成 release/latest.json 并打印清单
 *   node tools/publish-updates.mjs --notes "更新说明"       # 自定义说明
 *   node tools/publish-updates.mjs --upload github          # 生成并用 gh CLI 发布到 GitHub Releases
 *
 * 发布物（GitHub 通道，全部匿名可下载）：
 *   - latest.json       更新清单（Tauri updater 端点 fixed URL）
 *   - tanyue-setup.exe  安装包（稳定 ASCII 资产名，端点在 latest.json 中）
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const version = argValue("--version", null) || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const upload = args.includes("--upload") ? argValue("--upload", "github") : null;
const endpoints = argValue(
  "--endpoint",
  "https://github.com/zpp666123-del/tanyue/releases/latest/download"
);

// 更新说明走 UTF-8 文件（--notes-file），避免 Windows 命令行按 ACP 传参造成中文乱码。
const notesFile = argValue("--notes-file", null);
const notes = notesFile
  ? readFileSync(resolve(root, notesFile), "utf8").trim()
  : argValue("--notes", "应用内检查更新与自动升级已可用。");

const releaseDir = join(root, "release");
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");

function findInstaller() {
  const candidates = readdirSync(nsisDir).filter(
    (name) => name.includes(version) && name.endsWith("_x64-setup.exe")
  );
  if (!candidates.length) {
    throw new Error(
      `没有在 ${nsisDir} 找到 ${version} 的 NSIS 安装包。请先运行 npm run release:windows（含签名密钥）。`
    );
  }
  return candidates[0];
}

const builtName = findInstaller();
const installerSource = join(nsisDir, builtName);
const sigSource = join(nsisDir, `${builtName}.sig`);
if (!existsSync(sigSource)) {
  throw new Error(
    `缺少安装包签名 ${sigSource}。请确认私钥已配置（TAURI_SIGNING_PRIVATE_KEY_PATH 指向 keys/tanyue-updater.key）且 bundle.createUpdaterArtifacts 已开启。`
  );
}

const signature = readFileSync(sigSource, "utf8").trim();
const stableAssetName = "tanyue-setup.exe";
const latestJson = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `${endpoints.replace(/\/+$/, "")}/${stableAssetName}`
    }
  }
};

mkdirSync(releaseDir, { recursive: true });
writeFileSync(join(releaseDir, "latest.json"), `${JSON.stringify(latestJson, null, 2)}\n`, "utf8");
copyFileSync(installerSource, join(releaseDir, stableAssetName));

console.log(`[publish] 版本：${version}`);
console.log(`[publish] 清单：${join(releaseDir, "latest.json")}`);
console.log(`[publish] 安装包：${join(releaseDir, stableAssetName)}（原名 ${builtName}）`);
console.log(`[publish] 端点：${latestJson.platforms["windows-x86_64"].url}`);
console.log(`[publish] 一致性：package.json=${version} 文件名=${builtName} 清单=${latestJson.version}`);
if (version !== builtName.match(/\d+\.\d+\.\d+/)?.[0]) {
  throw new Error(`版本不一致：清单 ${version} vs 安装包 ${builtName}`);
}

if (upload === "gh" || upload === "github") {
  const tag = `v${version}`;
  const repo = "zpp666123-del/tanyue";
  const check = spawnSync("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName"], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  const exists = check.status === 0;
  let result;
  if (exists) {
    console.log(`[publish] Release ${tag} 已存在，使用 upload --clobber 更新资产。`);
    result = spawnSync(
      "gh",
      ["release", "upload", tag, "--repo", repo, "--clobber", join(releaseDir, "latest.json"), join(releaseDir, stableAssetName)],
      { cwd: root, encoding: "utf8", stdio: "inherit", shell: false }
    );
  } else {
    // 说明走 UTF-8 文件传入 gh，避免命令行按 ACP 编码传参乱码。
    const notesArg = notesFile
      ? ["--notes-file", notesFile]
      : ["--notes", notes];
    result = spawnSync(
      "gh",
      ["release", "create", tag, "--repo", repo, "--title", `弹阅 v${version}`, ...notesArg, join(releaseDir, "latest.json"), join(releaseDir, stableAssetName)],
      { cwd: root, encoding: "utf8", stdio: "inherit", shell: false }
    );
  }
  if (result.error || result.status !== 0) {
    console.error("[publish] GitHub 发布失败，可手动上传 release/latest.json 与 release/tanyue-setup.exe。");
    process.exit(result.status || 1);
  }
  console.log(`[publish] 已发布 ${tag}：用户端通过 https://github.com/${repo}/releases/latest/download/latest.json 匿名拉取更新。`);
} else {
  console.log("[publish] dry-run 完成（未上传）。正式发布请加 --upload github。");
}
