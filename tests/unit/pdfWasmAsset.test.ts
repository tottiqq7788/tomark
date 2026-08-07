import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("pdf wasm asset", () => {
  it("keeps the copied wasm identical to the npm package and valid", () => {
    const packaged = path.join(
      root,
      "deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm",
    );
    const asset = path.join(root, "src/assets/pdf/libhtml2realpdf.wasm");
    expect(existsSync(packaged)).toBe(true);
    expect(existsSync(asset)).toBe(true);

    const packagedBytes = readFileSync(packaged);
    const assetBytes = readFileSync(asset);
    expect(packagedBytes.subarray(0, 4).toString("binary")).toBe("\0asm");
    expect(assetBytes.subarray(0, 4).toString("binary")).toBe("\0asm");
    expect(createHash("sha256").update(assetBytes).digest("hex")).toBe(
      createHash("sha256").update(packagedBytes).digest("hex"),
    );
  });

  it("keeps required export fonts under src/assets/fonts", () => {
    const fontsDir = path.join(root, "src/assets/fonts");
    const names = new Set(readdirSync(fontsDir));
    for (const required of [
      "SourceHanSansSC-VF.ttf",
      "SourceCodePro-Regular.ttf",
      "SourceCodePro-Bold.ttf",
      "NotoSansSymbols2-Regular.ttf",
      "NotoEmoji-Regular.ttf",
    ]) {
      expect(names.has(required)).toBe(true);
      const magic = readFileSync(path.join(fontsDir, required)).subarray(0, 4);
      expect([
        Buffer.from([0x00, 0x01, 0x00, 0x00]).toString("binary"),
        "OTTO",
      ]).toContain(magic.toString("binary"));
    }
  });
});
