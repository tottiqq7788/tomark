import type { UnlistenFn } from "@tauri-apps/api/event";
import { isWindows } from "@/shared/isWindows";

export interface AppMenuHandlers {
  newDocument: () => void | Promise<void>;
  openDocument: () => void | Promise<void>;
  saveAs: () => void | Promise<void>;
  isBlocked?: () => boolean;
}

export interface AppMenuInstallation {
  /** Native app-menu accelerators own file shortcuts on macOS/Linux only. */
  fileOpsViaMenu: boolean;
  /** Windows custom titlebar opens the native File menu at logical coordinates. */
  popupFileMenu: ((x: number, y: number) => Promise<void>) | null;
  dispose: UnlistenFn;
}

/**
 * Installs the platform menu surface. macOS/Linux use the native app menu;
 * Windows exposes a native popup for the custom one-line titlebar.
 */
export async function installAppMenu(
  handlers: AppMenuHandlers,
): Promise<AppMenuInstallation> {
  const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import(
    "@tauri-apps/api/menu"
  );
  const isMac = navigator.userAgent.includes("Mac");

  const run = (action: () => void | Promise<void>) => {
    if (handlers.isBlocked?.()) {
      return;
    }
    void action();
  };

  const createFileItems = async () => [
    await MenuItem.new({
      id: "file-new",
      text: "新建",
      accelerator: "CmdOrCtrl+N",
      action: () => run(handlers.newDocument),
    }),
    await MenuItem.new({
      id: "file-open",
      text: "打开…",
      accelerator: "CmdOrCtrl+O",
      action: () => run(handlers.openDocument),
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({
      id: "file-save-as",
      text: "另存为…",
      accelerator: "CmdOrCtrl+Shift+S",
      action: () => run(handlers.saveAs),
    }),
  ];

  if (isWindows()) {
    const menu = await Menu.new({ items: await createFileItems() });
    return {
      fileOpsViaMenu: false,
      popupFileMenu: async (x, y) => {
        const [{ LogicalPosition }, { getCurrentWindow }] = await Promise.all([
          import("@tauri-apps/api/dpi"),
          import("@tauri-apps/api/window"),
        ]);
        await menu.popup(new LogicalPosition(x, y), getCurrentWindow());
      },
      dispose: () => {
        // Resource lifetime is tied to the WebView; no attached window menu remains.
      },
    };
  }

  const fileSubmenu = await Submenu.new({
    text: "文件",
    items: await createFileItems(),
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
    const menu = await Menu.new({ items: [appSubmenu, fileSubmenu] });
    await menu.setAsAppMenu();
  } else {
    const menu = await Menu.new({ items: [fileSubmenu] });
    await menu.setAsAppMenu();
  }

  return {
    fileOpsViaMenu: true,
    popupFileMenu: null,
    dispose: () => {
      // Native menu is replaced on next install; nothing to free per-item.
    },
  };
}
