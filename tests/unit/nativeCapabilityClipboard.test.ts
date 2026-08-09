import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadJson(relativePath: string): { permissions?: string[] } {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8")) as {
    permissions?: string[];
  };
}

describe("native clipboard capability contract", () => {
  it("grants only clipboard-manager:allow-read-image in production capabilities", () => {
    const capability = loadJson("src-tauri/capabilities/default.json");
    const permissions = capability.permissions ?? [];
    const clipboardPerms = permissions.filter((item) =>
      item.startsWith("clipboard-manager:")
    );
    expect(clipboardPerms).toEqual(["clipboard-manager:allow-read-image"]);
    expect(permissions).not.toContain("clipboard-manager:default");
    expect(permissions).not.toContain("clipboard-manager:allow-read-text");
    expect(permissions).not.toContain("clipboard-manager:allow-write-text");
    expect(permissions).not.toContain("clipboard-manager:allow-write-image");
    expect(permissions).not.toContain("clipboard-manager:allow-clear");
  });

  it("records e2e capability delta while keeping read-image only for clipboard", () => {
    const e2e = JSON.parse(
      readFileSync(path.join(root, "src-tauri/tauri.e2e.conf.json"), "utf8"),
    ) as {
      app: {
        security: {
          capabilities: Array<{ permissions?: string[] }>;
        };
      };
    };
    const permissions = e2e.app.security.capabilities[0]?.permissions ?? [];
    const clipboardPerms = permissions.filter((item) =>
      item.startsWith("clipboard-manager:")
    );
    expect(clipboardPerms).toEqual(["clipboard-manager:allow-read-image"]);
    // Explicit E2E-only extras relative to production clipboard posture.
    expect(permissions).toContain("wdio:default");
    expect(permissions).toContain("wdio-webdriver:default");
    expect(permissions).toContain("core:window:allow-close");
  });
});
