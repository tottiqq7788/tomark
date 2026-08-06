import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_APP_PROMPT_STORAGE_KEY,
  markDefaultAppPromptSeen,
  shouldAutoShowDefaultAppPrompt,
} from "@/app/useDefaultAppSetup";

describe("useDefaultAppSetup helpers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-shows only for production Tauri installs once", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    } as unknown as Storage;

    expect(
      shouldAutoShowDefaultAppPrompt({
        isTauri: true,
        isDev: false,
        storage,
      }),
    ).toBe(true);

    expect(
      shouldAutoShowDefaultAppPrompt({
        isTauri: true,
        isDev: true,
        storage,
      }),
    ).toBe(false);

    expect(
      shouldAutoShowDefaultAppPrompt({
        isTauri: false,
        isDev: false,
        storage,
      }),
    ).toBe(false);

    storage.getItem = vi.fn(() => "1");
    expect(
      shouldAutoShowDefaultAppPrompt({
        isTauri: true,
        isDev: false,
        storage,
      }),
    ).toBe(false);
  });

  it("persists prompt dismissal", () => {
    const setItem = vi.fn();
    markDefaultAppPromptSeen({ setItem } as unknown as Storage);
    expect(setItem).toHaveBeenCalledWith(DEFAULT_APP_PROMPT_STORAGE_KEY, "1");
  });
});
