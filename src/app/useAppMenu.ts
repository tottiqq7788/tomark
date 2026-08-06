import type { UnlistenFn } from "@tauri-apps/api/event";

export interface AppMenuHandlers {
  newDocument: () => void | Promise<void>;
  openDocument: () => void | Promise<void>;
  saveAs: () => void | Promise<void>;
}

/**
 * Installs a native app menu with File → 新建 / 打开 / 另存为.
 * On macOS the first submenu occupies the application menu slot.
 */
export async function installAppMenu(
  handlers: AppMenuHandlers,
): Promise<UnlistenFn> {
  const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import(
    "@tauri-apps/api/menu"
  );
  const isMac = navigator.userAgent.includes("Mac");

  const fileSubmenu = await Submenu.new({
    text: "文件",
    items: [
      await MenuItem.new({
        id: "file-new",
        text: "新建",
        accelerator: "CmdOrCtrl+N",
        action: () => {
          void handlers.newDocument();
        },
      }),
      await MenuItem.new({
        id: "file-open",
        text: "打开…",
        accelerator: "CmdOrCtrl+O",
        action: () => {
          void handlers.openDocument();
        },
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        id: "file-save-as",
        text: "另存为…",
        accelerator: "CmdOrCtrl+Shift+S",
        action: () => {
          void handlers.saveAs();
        },
      }),
    ],
  });

  if (isMac) {
    const appSubmenu = await Submenu.new({
      text: "tomark",
      items: [
        await PredefinedMenuItem.new({ item: { About: null } }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Hide" }),
        await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Quit" }),
      ],
    });
    const menu = await Menu.new({
      items: [appSubmenu, fileSubmenu],
    });
    await menu.setAsAppMenu();
  } else {
    const menu = await Menu.new({
      items: [fileSubmenu],
    });
    await menu.setAsAppMenu();
  }

  return () => {
    // Native menu is replaced on next install; nothing to free per-item.
  };
}
