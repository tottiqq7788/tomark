import { onBeforeUnmount, onMounted, ref } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface WindowsTitlebarOptions {
  enabled: boolean;
  onError?: (message: string) => void;
}

export function useWindowsTitlebar(options: WindowsTitlebarOptions) {
  const maximized = ref(false);
  let unlistenResize: UnlistenFn | null = null;

  async function withWindow(
    action: (window: import("@tauri-apps/api/window").Window) => Promise<void>,
  ) {
    if (!options.enabled) {
      return;
    }
    try {
      const [{ isTauri }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/window"),
      ]);
      if (isTauri()) {
        await action(getCurrentWindow());
      }
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function refreshMaximized() {
    await withWindow(async (window) => {
      maximized.value = await window.isMaximized();
    });
  }

  async function minimize() {
    await withWindow((window) => window.minimize());
  }

  async function toggleMaximize() {
    await withWindow(async (window) => {
      await window.toggleMaximize();
      maximized.value = await window.isMaximized();
    });
  }

  async function closeWindow() {
    // close() emits onCloseRequested; destroy() would bypass the dirty guard.
    await withWindow((window) => window.close());
  }

  async function onDragRegionMouseDown(event: MouseEvent) {
    if (event.button !== 0) {
      return;
    }
    if (event.detail === 2) {
      await toggleMaximize();
      return;
    }
    await withWindow((window) => window.startDragging());
  }

  onMounted(() => {
    if (!options.enabled) {
      return;
    }
    void (async () => {
      await refreshMaximized();
      try {
        const [{ isTauri }, { getCurrentWindow }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/window"),
        ]);
        if (!isTauri()) {
          return;
        }
        unlistenResize = await getCurrentWindow().onResized(() => {
          void refreshMaximized();
        });
      } catch (error) {
        options.onError?.(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  });

  onBeforeUnmount(() => {
    unlistenResize?.();
    unlistenResize = null;
  });

  return {
    maximized,
    minimize,
    toggleMaximize,
    closeWindow,
    onDragRegionMouseDown,
  };
}
