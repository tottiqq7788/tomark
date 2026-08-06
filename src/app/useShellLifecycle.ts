import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type ShellLifecycleSession = {
  dirty: Ref<boolean>;
  saving: Ref<boolean>;
  dirtyDialogOpen: Ref<boolean>;
  statusMessage: Ref<string>;
  setContent: (value: string) => void;
  guardDirty: () => Promise<boolean>;
  flushAutosave: () => Promise<void> | void;
  newDocument: () => unknown;
  openDocument: () => unknown;
  openDocumentAtPath: (path: string) => Promise<boolean>;
  saveAs: () => unknown;
  dispose: () => void;
};

export type ShellLifecyclePreview = {
  refreshPreview: { cancel: () => void };
};

/**
 * Tauri window close / app-exit guards, native menu install, and e2e hooks.
 */
export function useShellLifecycle(
  session: ShellLifecycleSession,
  preview: ShellLifecyclePreview,
) {
  const fileOpsViaMenu = ref(false);

  let unlistenCloseRequested: UnlistenFn | null = null;
  let unlistenMenu: UnlistenFn | null = null;
  let unlistenAppExitRequested: UnlistenFn | null = null;
  let unlistenOpenFile: UnlistenFn | null = null;
  let unmounted = false;
  let destroyingWindow = false;
  let appExitInFlight = false;
  let openInFlight: Promise<void> | null = null;

  async function handleExternalOpenPath(filePath: string) {
    if (unmounted) {
      return;
    }
    const run = async () => {
      await session.openDocumentAtPath(filePath);
    };
    openInFlight = (openInFlight ?? Promise.resolve())
      .catch(() => undefined)
      .then(run);
    await openInFlight;
  }

  async function onAppExitRequested() {
    if (appExitInFlight || unmounted) {
      return;
    }
    appExitInFlight = true;
    try {
      if (!(await session.guardDirty()) || unmounted) {
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("confirm_app_exit");
    } catch (error) {
      session.statusMessage.value = `退出应用失败：${
        error instanceof Error ? error.message : String(error)
      }`;
    } finally {
      appExitInFlight = false;
    }
  }

  onMounted(async () => {
    if (import.meta.env.VITE_WDIO === "1") {
      (
        window as unknown as {
          __tomarkE2e?: {
            setContent: (value: string) => void;
            isDirty: () => boolean;
          };
        }
      ).__tomarkE2e = {
        setContent: session.setContent,
        isDirty: () => session.dirty.value,
      };
    }

    const [{ isTauri, invoke }, { getCurrentWindow }, { listen }] =
      await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/window"),
        import("@tauri-apps/api/event"),
      ]);
    if (!isTauri() || unmounted) {
      return;
    }

    try {
      unlistenOpenFile = await listen<{ path: string }>(
        "tomark-open-file",
        (event) => {
          void handleExternalOpenPath(event.payload.path);
        },
      );
      const queued =
        (await invoke<string[]>("acknowledge_open_file_listener")) ?? [];
      if (!unmounted) {
        for (const filePath of queued) {
          void handleExternalOpenPath(filePath);
        }
      }
    } catch (error) {
      session.statusMessage.value = `未能启用外部打开：${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (unmounted) {
      return;
    }

    const appWindow = getCurrentWindow();
    try {
      const unlisten = await appWindow.listen(
        "tomark-app-exit-requested",
        () => {
          void onAppExitRequested();
        },
      );
      if (unmounted) {
        unlisten();
        return;
      }
      unlistenAppExitRequested = unlisten;
    } catch (error) {
      session.statusMessage.value = `未能启用退出保护：${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    fileOpsViaMenu.value = false;
    try {
      const { installAppMenu } = await import("./useAppMenu");
      if (unmounted) {
        return;
      }
      unlistenMenu = await installAppMenu({
        newDocument: () => {
          void session.newDocument();
        },
        openDocument: () => {
          void session.openDocument();
        },
        saveAs: () => {
          void session.saveAs();
        },
        isBlocked: () =>
          session.saving.value || session.dirtyDialogOpen.value,
      });
      if (unmounted) {
        unlistenMenu?.();
        unlistenMenu = null;
        return;
      }
      fileOpsViaMenu.value = true;
    } catch (error) {
      if (unmounted) {
        return;
      }
      fileOpsViaMenu.value = false;
      session.statusMessage.value = `未能安装应用菜单：${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (unmounted) {
      return;
    }

    try {
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        await session.flushAutosave();
        if (!session.dirty.value) {
          return;
        }
        event.preventDefault();
        if (!(await session.guardDirty()) || destroyingWindow) {
          return;
        }
        destroyingWindow = true;
        try {
          await appWindow.destroy();
        } catch (error) {
          destroyingWindow = false;
          session.statusMessage.value = `关闭窗口失败：${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      });
      if (unmounted) {
        unlisten();
      } else {
        unlistenCloseRequested = unlisten;
      }
    } catch (error) {
      session.statusMessage.value = `未能启用关闭保护：${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  });

  onBeforeUnmount(() => {
    unmounted = true;
    unlistenCloseRequested?.();
    unlistenMenu?.();
    unlistenAppExitRequested?.();
    unlistenOpenFile?.();
    session.dispose();
    preview.refreshPreview.cancel();
    if (import.meta.env.VITE_WDIO === "1") {
      delete (window as unknown as { __tomarkE2e?: unknown }).__tomarkE2e;
    }
  });

  return { fileOpsViaMenu };
}
