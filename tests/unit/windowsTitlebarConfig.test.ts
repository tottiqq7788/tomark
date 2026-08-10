import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as {
    app?: { windows?: Array<Record<string, unknown>> };
    permissions?: string[];
  };
}

describe("Windows titlebar configuration", () => {
  it("disables decorations only in the Windows platform override", () => {
    const base = readJson("src-tauri/tauri.conf.json");
    const windows = readJson("src-tauri/tauri.windows.conf.json");
    const macOS = readJson("src-tauri/tauri.macos.conf.json");

    expect(base.app?.windows?.[0]?.decorations).toBeUndefined();
    expect(windows.app?.windows?.[0]?.decorations).toBe(false);
    expect(macOS.app?.windows?.[0]?.decorations).toBe(true);
    expect(macOS.app?.windows?.[0]?.titleBarStyle).toBe("Overlay");
  });

  it("grants only the explicit window commands used by the custom chrome", () => {
    const capability = readJson("src-tauri/capabilities/default.json");
    const permissions = capability.permissions ?? [];

    expect(permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-close",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-is-maximized",
        "core:window:allow-start-dragging",
      ]),
    );
    expect(permissions).not.toContain("core:window:default");
  });
});
