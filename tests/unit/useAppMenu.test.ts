import { beforeEach, describe, expect, it, vi } from "vitest";

const platformMocks = vi.hoisted(() => ({
  windows: false,
}));

const menuMocks = vi.hoisted(() => {
  const popup = vi.fn(async () => undefined);
  const setAsAppMenu = vi.fn(async () => undefined);
  const menu = { popup, setAsAppMenu };
  return {
    menu,
    menuNew: vi.fn(async () => menu),
    menuItemNew: vi.fn(async (options: unknown) => options),
    predefinedNew: vi.fn(async (options: unknown) => options),
    submenuNew: vi.fn(async (options: unknown) => options),
    popup,
    setAsAppMenu,
  };
});

const currentWindow = { label: "main" };

vi.mock("@/shared/isWindows", () => ({
  isWindows: () => platformMocks.windows,
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: menuMocks.menuNew },
  MenuItem: { new: menuMocks.menuItemNew },
  PredefinedMenuItem: { new: menuMocks.predefinedNew },
  Submenu: { new: menuMocks.submenuNew },
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => currentWindow,
}));

import { installAppMenu } from "@/app/useAppMenu";

describe("installAppMenu", () => {
  beforeEach(() => {
    platformMocks.windows = false;
    menuMocks.menuNew.mockClear();
    menuMocks.menuItemNew.mockClear();
    menuMocks.predefinedNew.mockClear();
    menuMocks.submenuNew.mockClear();
    menuMocks.popup.mockClear();
    menuMocks.setAsAppMenu.mockClear();
  });

  it("exposes a native popup instead of attaching a Windows menu row", async () => {
    platformMocks.windows = true;
    const newDocument = vi.fn();
    const installation = await installAppMenu({
      newDocument,
      openDocument: vi.fn(),
      saveAs: vi.fn(),
    });

    expect(installation.fileOpsViaMenu).toBe(false);
    expect(installation.popupFileMenu).not.toBeNull();
    expect(menuMocks.submenuNew).not.toHaveBeenCalled();
    expect(menuMocks.setAsAppMenu).not.toHaveBeenCalled();

    await installation.popupFileMenu?.(12, 28);
    expect(menuMocks.popup).toHaveBeenCalledWith(
      expect.objectContaining({ x: 12, y: 28 }),
      currentWindow,
    );

    const newItem = menuMocks.menuItemNew.mock.calls.find(
      ([options]) => (options as { id?: string }).id === "file-new",
    )?.[0] as { action: () => void };
    newItem.action();
    expect(newDocument).toHaveBeenCalledOnce();
  });

  it("keeps non-Windows file operations on the attached native menu", async () => {
    const installation = await installAppMenu({
      newDocument: vi.fn(),
      openDocument: vi.fn(),
      saveAs: vi.fn(),
    });

    expect(installation.fileOpsViaMenu).toBe(true);
    expect(installation.popupFileMenu).toBeNull();
    expect(menuMocks.submenuNew).toHaveBeenCalled();
    expect(menuMocks.setAsAppMenu).toHaveBeenCalledOnce();
  });
});
