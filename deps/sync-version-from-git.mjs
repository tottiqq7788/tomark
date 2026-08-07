#!/usr/bin/env node
/**
 * 将安装包/产品版本与 git 中的 vX.Y.Z 对齐。
 * 解析：本地 git tag（v*）与「提交说明以 vX.Y.Z 开头」的最近版本，取二者中较新的。
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

function semverTuple(semver) {
  return semver.split(".").map((part) => Number.parseInt(part, 10));
}

function isNewer(a, b) {
  const left = semverTuple(a.semver);
  const right = semverTuple(b.semver);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] > right[i];
    }
  }
  return false;
}

function resolveVersion() {
  const fromTag = parseV(
    git(["describe", "--tags", "--match", "v*", "--abbrev", "0"]),
  );
  let fromCommit = null;
  const subjects = git(["log", "--pretty=%s", "-n", "200"])
    .split("\n")
    .filter(Boolean);
  for (const subject of subjects) {
    const hit = parseV(subject);
    if (hit) {
      fromCommit = hit;
      break;
    }
  }

  if (fromTag && fromCommit) {
    if (isNewer(fromCommit, fromTag)) {
      return { ...fromCommit, source: "git-commit" };
    }
    return { ...fromTag, source: "git-tag" };
  }
  if (fromTag) return { ...fromTag, source: "git-tag" };
  if (fromCommit) return { ...fromCommit, source: "git-commit" };
  return null;
}

function replaceJsonVersion(filePath, semver) {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  if (data.version === semver) {
    return false;
  }
  data.version = semver;
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

function replaceCargoVersion(filePath, semver) {
  const text = readFileSync(filePath, "utf8");
  const current = text.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (current?.[1] === semver) {
    return false;
  }
  const next = text.replace(
    /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${semver}$2`,
  );
  if (next === text) {
    throw new Error(`未能在 ${filePath} 中更新 [package].version`);
  }
  writeFileSync(filePath, next);
  return true;
}

function replacePackageLockVersion(filePath, semver) {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  let changed = data.version !== semver;
  data.version = semver;
  if (data.packages?.[""]) {
    if (data.packages[""].version !== semver) {
      changed = true;
    }
    data.packages[""].version = semver;
  }
  if (!changed) {
    return false;
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return true;
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
console.log(
  "已写入：src-tauri/tauri.conf.json、src-tauri/Cargo.toml、deps/package.json、deps/package-lock.json",
);
