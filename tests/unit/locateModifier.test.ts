import { describe, expect, it, vi, afterEach } from "vitest";
import { isLocateModifier } from "@/shared/locateModifier";

describe("isLocateModifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Cmd on Apple platforms and ignores Ctrl", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Macintosh; Intel Mac OS X",
    });
    expect(
      isLocateModifier({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } as MouseEvent),
    ).toBe(true);
    expect(
      isLocateModifier({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false } as MouseEvent),
    ).toBe(false);
  });

  it("uses Ctrl on non-Apple platforms", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgent: "Windows NT 10.0",
    });
    expect(
      isLocateModifier({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false } as MouseEvent),
    ).toBe(true);
    expect(
      isLocateModifier({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } as MouseEvent),
    ).toBe(false);
  });
});
