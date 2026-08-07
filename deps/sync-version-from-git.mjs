#!/usr/bin/env node
/**
 * 将安装包/产品版本与 git 中的 vX.Y.Z 对齐。
 * 解析顺序：本地 git tag（v*）→ 提交说明中以 vX.Y.Z 开头的最近版本。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function parseV(raw) {
  const m = String(raw).trim().match(/^v(\d+\.\d+\.\d+)\b/);
  return m ? { tag: `v${m[1]}`, semver: m[1] } : null;
}

function resolveVersion() {
  const fromTag = parseV(git(["describe", "--tags", "--match", "v*", "--abbrev=0"]));
  if (fromTag) return { ...fromTag, source: "git-tag" };

  const subjects = git(["log", "--pretty=%s", "-n", "200"]).split("\n").filter(Boolean);
  for (const subject of subjects) {
    const hit = parseV(subject);
    if (hit) return { ...hit, source: "git-commit" };
  }
  return null;
}

function replaceJsonVersion(filePath, semver) {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  data.version = semver;
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function replaceCargoVersion(filePath, semver) {
  const text = readFileSync(filePath, "utf8");
  const next = text.replace(
    /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${semver}$2`,
  );
  if (next === text) {
    throw new Error(`未能在 ${filePath} 中更新 [package].version`);
  }
  writeFileSync(filePath, next);
}

function replacePackageLockVersion(filePath, semver) {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  data.version = semver;
  if (data.packages?.[""]) {
    data.packages[""].version = semver;
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

const resolved = resolveVersion();
if (!resolved) {
  console.error(
    "未找到 git 版本（tag 或提交说明中的 vX.Y.Z）。请先执行「提交到git」，再打包。",
  );
  process.exit(1);
}

const { tag, semver, source } = resolved;
replaceJsonVersion(join(root, "src-tauri/tauri.conf.json"), semver);
replaceCargoVersion(join(root, "src-tauri/Cargo.toml"), semver);
replaceJsonVersion(join(root, "deps/package.json"), semver);
replacePackageLockVersion(join(root, "deps/package-lock.json"), semver);

console.log(`已同步产品版本 → ${tag}（${semver}，来源：${source}）`);
console.log("已写入：src-tauri/tauri.conf.json、src-tauri/Cargo.toml、deps/package.json、deps/package-lock.json");
