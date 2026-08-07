#!/usr/bin/env node
/**
 * Force a paged PDF export through the running tauri:dev WebView.
 * Handshake is via temp files (WKWebView does not receive Vite HMR customs reliably).
 *
 * Requires: deps `npm run tauri:dev -- --config src-tauri/tauri.dev.local`
 */
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useSmoke = process.argv.includes("--smoke");
const fixture = useSmoke
  ? "# Force 分页 PDF\n\n你好 tomark。包含中文与符号：😀\n\n- a\n- b\n"
  : readFileSync(
      path.join(root, "tests/fixtures/export-paged-pdf.md"),
      "utf8",
    );
const outPath = path.join(tmpdir(), `tomark-force-paged-${Date.now()}.pdf`);
const jobPath = path.join(tmpdir(), "tomark-force-export-job.json");
const resultPath = path.join(tmpdir(), "tomark-force-export-result.json");
const statusPath = path.join(tmpdir(), "tomark-force-export-status.txt");

for (const p of [jobPath, resultPath, statusPath]) {
  if (existsSync(p)) {
    unlinkSync(p);
  }
}

const job = {
  format: "pdf-paged",
  path: outPath,
  markdown: fixture,
  fileName: useSmoke ? "force-smoke.md" : "export-paged-pdf.md",
};
writeFileSync(jobPath, JSON.stringify(job), "utf8");
console.log(`Wrote job → ${jobPath}`);
console.log(`Expect PDF → ${outPath}`);

const deadline = Date.now() + 180_000;
let payload = null;
let lastStatus = "";
while (Date.now() < deadline) {
  if (existsSync(statusPath)) {
    const status = readFileSync(statusPath, "utf8");
    if (status !== lastStatus) {
      lastStatus = status;
      console.log(`[status] ${status}`);
    }
  }
  if (existsSync(resultPath)) {
    payload = JSON.parse(readFileSync(resultPath, "utf8"));
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}

if (!payload) {
  console.error("Timed out waiting for tomark-force-export-result.json");
  if (lastStatus) {
    console.error("Last status:", lastStatus);
  }
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
if (!payload?.ok) {
  console.error("Force export failed");
  process.exit(1);
}

if (!existsSync(outPath)) {
  console.error("Output file missing:", outPath);
  process.exit(1);
}
const size = statSync(outPath).size;
const head = readFileSync(outPath).subarray(0, 5).toString("latin1");
console.log(`Wrote ${size} bytes, magic=${JSON.stringify(head)}`);
if (!head.startsWith("%PDF")) {
  console.error("Not a PDF");
  process.exit(1);
}
console.log("OK");
