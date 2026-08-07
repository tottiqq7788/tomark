#!/usr/bin/env node
/**
 * Keep src/assets/pdf/libhtml2realpdf.wasm in sync with the npm package.
 * The wasm is gitignored (large binary); this script copies it when missing
 * or when the package hash differs.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = path.join(
  root,
  "deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm",
);
const assetDir = path.join(root, "src/assets/pdf");
const asset = path.join(assetDir, "libhtml2realpdf.wasm");

function fail(message) {
  console.error(`[check-pdf-wasm-sync] ${message}`);
  process.exit(1);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (!existsSync(packaged)) {
  fail(
    `missing package wasm: ${packaged}\n` +
      `Run: cd deps && npm install --legacy-peer-deps`,
  );
}

const packagedBytes = readFileSync(packaged);
if (packagedBytes.subarray(0, 4).toString("binary") !== "\0asm") {
  fail("package wasm missing \\0asm magic");
}

const packagedHash = sha256(packagedBytes);
let needsCopy = !existsSync(asset);
if (!needsCopy) {
  const assetBytes = readFileSync(asset);
  if (
    assetBytes.subarray(0, 4).toString("binary") !== "\0asm" ||
    sha256(assetBytes) !== packagedHash
  ) {
    needsCopy = true;
  }
}

if (needsCopy) {
  mkdirSync(assetDir, { recursive: true });
  copyFileSync(packaged, asset);
  console.log(
    `[check-pdf-wasm-sync] copied wasm from @imggion/html2realpdf (sha256=${packagedHash})`,
  );
} else {
  console.log(`[check-pdf-wasm-sync] ok sha256=${packagedHash}`);
}
