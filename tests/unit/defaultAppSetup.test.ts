import { describe, expect, it, vi, beforeEach } from "vitest";
import { effectScope } from "vue";
import {
  DEFAULT_APP_PROMPT_STORAGE_KEY,
  markDefaultAppPromptSeen,
  shouldAutoShowDefaultAppPrompt,
  useDefaultAppSetup,
} from "@/app/useDefaultAppSetup";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

describe("useDefaultAppSetup helpers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    invoke.mockReset();
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

  it("closes the prompt after a successful default-app request", async () => {
    invoke.mockResolvedValue({
      ok: true,
      message: "已请求将 tomark 设为 Markdown 默认应用",
      openedSettings: false,
    });
    const setItem = vi.fn();
    const storage = {
      getItem: vi.fn(() => null),
      setItem,
    } as unknown as Storage;

    const scope = effectScope();
    const setup = scope.run(() =>
      useDefaultAppSetup({ autoPrompt: false, storage }),
    );
    expect(setup).toBeTruthy();
    setup!.showPrompt();
    expect(setup!.open.value).toBe(true);

    const result = await setup!.requestDefaultApp();
    expect(result.ok).toBe(true);
    expect(setup!.open.value).toBe(false);
    expect(setItem).toHaveBeenCalledWith(DEFAULT_APP_PROMPT_STORAGE_KEY, "1");
    scope.stop();
  });

  it("keeps the prompt open when the request fails", async () => {
    invoke.mockResolvedValue({
      ok: false,
      message: "无法定位应用路径",
      openedSettings: false,
    });
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    } as unknown as Storage;

    const scope = effectScope();
    const setup = scope.run(() =>
      useDefaultAppSetup({ autoPrompt: false, storage }),
    )!;
    setup.showPrompt();
    await setup.requestDefaultApp();
    expect(setup.open.value).toBe(true);
    expect(setup.statusMessage.value).toContain("无法定位");
    scope.stop();
  });
});
