#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = path.join(
  root,
  "deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm",
);
const asset = path.join(root, "src/assets/pdf/libhtml2realpdf.wasm");

function fail(message) {
  console.error(`[check-pdf-wasm-sync] ${message}`);
  process.exit(1);
}

if (!existsSync(packaged)) {
  fail(`missing package wasm: ${packaged}`);
}
if (!existsSync(asset)) {
  fail(`missing app asset wasm: ${asset}`);
}

const packagedBytes = readFileSync(packaged);
const assetBytes = readFileSync(asset);

if (packagedBytes.subarray(0, 4).toString("binary") !== "\0asm") {
  fail("package wasm missing \\0asm magic");
}
if (assetBytes.subarray(0, 4).toString("binary") !== "\0asm") {
  fail("asset wasm missing \\0asm magic");
}

const packagedHash = createHash("sha256").update(packagedBytes).digest("hex");
const assetHash = createHash("sha256").update(assetBytes).digest("hex");
if (packagedHash !== assetHash) {
  fail(
    `wasm out of sync with @imggion/html2realpdf.\n` +
      `  package: ${packagedHash}\n` +
      `  asset:   ${assetHash}\n` +
      `Copy with:\n` +
      `  cp deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm src/assets/pdf/libhtml2realpdf.wasm`,
  );
}

console.log(`[check-pdf-wasm-sync] ok sha256=${assetHash}`);
