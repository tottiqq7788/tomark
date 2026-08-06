import { afterEach, describe, expect, it, vi } from "vitest";
import { isMacOS } from "@/shared/isMacOS";

describe("isMacOS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Apple platforms", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Macintosh; Intel Mac OS X",
    });
    expect(isMacOS()).toBe(true);
  });

  it("rejects Windows platforms", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgent: "Windows NT 10.0",
    });
    expect(isMacOS()).toBe(false);
  });
});
