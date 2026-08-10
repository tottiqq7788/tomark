import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type ShellLifecycleSession = {
  dirty: Ref<boolean>;
  saving: Ref<boolean>;
  dirtyDialogOpen: Ref<boolean>;
  statusMessage: Ref<string>;
  content: Ref<string>;
  documentVersion: Ref<number>;
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
  flushEditSession?: () => Promise<void>;
};

/**
 * Tauri window close / app-exit guards, native menu install, and e2e hooks.
 */
export type ShellLifecycleOptions = {
  /** Extra file-ops gate (drawers / export busy), stacked with saving & dirty dialog. */
  isBlocked?: () => boolean;
  /** E2E / forced-path single Mermaid PNG export via the live preview registry. */
  exportMermaidDiagramPngAt?: (
    diagramIndex: number,
    targetPath: string,
  ) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
  /** E2E / forced-path single Mermaid SVG export via the live preview registry. */
  exportMermaidDiagramSvgAt?: (
    diagramIndex: number,
    targetPath: string,
  ) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
};

export function useShellLifecycle(
  session: ShellLifecycleSession,
  preview: ShellLifecyclePreview,
  options: ShellLifecycleOptions = {},
) {
  const fileOpsViaMenu = ref(false);
  const popupFileMenu = ref<((x: number, y: number) => Promise<void>) | null>(
    null,
  );

  let unlistenCloseRequested: UnlistenFn | null = null;
  let unlistenMenu: UnlistenFn | null = null;
  let unlistenAppExitRequested: UnlistenFn | null = null;
  let unlistenOpenFile: UnlistenFn | null = null;
  let unmounted = false;
  let destroyingWindow = false;
  let appExitInFlight = false;
  let openInFlight: Promise<void> | null = null;
  let forceExportTimer: number | null = null;

  async function flushPreviewEdits() {
    await preview.flushEditSession?.();
  }

  async function handleExternalOpenPath(filePath: string) {
    if (unmounted) {
      return;
    }
    const run = async () => {
      await flushPreviewEdits();
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
      await flushPreviewEdits();
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
      const writeE2eExportResult = async (payload: unknown) => {
        try {
          const { invokeTauri } = await import("@/native/tauriRuntime");
          await invokeTauri("write_force_export_result", {
            payload: JSON.stringify(payload),
          });
        } catch {
          // The export result itself remains authoritative if diagnostics fail.
        }
      };
      (
        window as unknown as {
          __tomarkE2e?: {
            setContent: (value: string) => void;
            replaceContent: (value: string) => void;
            getContent: () => string;
            isDirty: () => boolean;
            preloadExportRenderers: () => Promise<void>;
            runExportToPath: (job: {
              format: string;
              path: string;
              markdown?: string;
              fileName?: string;
              documentPath?: string | null;
            }) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
            runMermaidDiagramPngToPath: (job: {
              path: string;
              diagramIndex?: number;
            }) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
            runMermaidDiagramSvgToPath: (job: {
              path: string;
              diagramIndex?: number;
            }) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
          };
        }
      ).__tomarkE2e = {
        setContent: session.setContent,
        replaceContent: (value: string) => {
          session.setContent(value);
          session.documentVersion.value += 1;
        },
        getContent: () => session.content.value,
        isDirty: () => session.dirty.value,
        preloadExportRenderers: async () => {
          const { preloadExportRenderer } = await import("@/export/runExport");
          await Promise.all([
            preloadExportRenderer("png"),
            preloadExportRenderer("pdf"),
          ]);
        },
        runExportToPath: async (job) => {
          let lastProgress = "尚未开始";
          try {
            if (!job?.format || !job?.path) {
              throw new Error("runExportToPath requires format and path");
            }
            const { runExport } = await import("@/export/runExport");
            const result = await runExport({
              format: job.format as import("@/export/types").ExportFormatId,
              markdownSource:
                typeof job.markdown === "string"
                  ? job.markdown
                  : session.content.value,
              documentPath: job.documentPath ?? null,
              fileName: job.fileName ?? "export.md",
              targetPath: job.path,
              onProgress: (message) => {
                lastProgress = message;
                session.statusMessage.value = message;
              },
            });
            session.statusMessage.value = `已导出：${result.fileName}`;
            const hookResult = {
              ok: true as const,
              fileName: result.fileName,
            };
            await writeE2eExportResult(hookResult);
            return hookResult;
          } catch (error) {
            const message = `${
              error instanceof Error ? error.message : String(error)
            }（最后进度：${lastProgress}）`;
            session.statusMessage.value = `导出失败：${message}`;
            const hookResult = { ok: false as const, error: message };
            await writeE2eExportResult(hookResult);
            return hookResult;
          }
        },
        runMermaidDiagramPngToPath: async (job) => {
          try {
            if (!job?.path) {
              throw new Error("runMermaidDiagramPngToPath requires path");
            }
            const exportAt = options.exportMermaidDiagramPngAt;
            if (!exportAt) {
              throw new Error("Mermaid PNG export hook is unavailable");
            }
            const result = await exportAt(job.diagramIndex ?? 1, job.path);
            await writeE2eExportResult(result);
            return result;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            session.statusMessage.value = `导出失败：${message}`;
            const hookResult = { ok: false as const, error: message };
            await writeE2eExportResult(hookResult);
            return hookResult;
          }
        },
        runMermaidDiagramSvgToPath: async (job) => {
          try {
            if (!job?.path) {
              throw new Error("runMermaidDiagramSvgToPath requires path");
            }
            const exportAt = options.exportMermaidDiagramSvgAt;
            if (!exportAt) {
              throw new Error("Mermaid SVG export hook is unavailable");
            }
            const result = await exportAt(job.diagramIndex ?? 1, job.path);
            await writeE2eExportResult(result);
            return result;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            session.statusMessage.value = `导出失败：${message}`;
            const hookResult = { ok: false as const, error: message };
            await writeE2eExportResult(hookResult);
            return hookResult;
          }
        },
      };
    }

    if (import.meta.env.DEV) {
      let forceExportBusy = false;
      forceExportTimer = window.setInterval(() => {
        if (forceExportBusy || unmounted) {
          return;
        }
        void (async () => {
          const { isTauriIpcReady, invokeTauri } = await import(
            "@/native/tauriRuntime"
          );
          if (!isTauriIpcReady()) {
            return;
          }
          forceExportBusy = true;
          try {
            const raw = await invokeTauri<string | null>(
              "poll_force_export_job",
            );
            if (!raw) {
              return;
            }
            const job = JSON.parse(raw) as {
              format?: string;
              path?: string;
              markdown?: string;
              fileName?: string;
              documentPath?: string | null;
            };
            try {
              if (!job?.format || !job?.path) {
                throw new Error("force-export requires format and path");
              }
              // Do NOT session.setContent(job.markdown): EditorPane only
              // reloads from modelValue when documentVersion bumps, so writing
              // content alone desyncs the preview from the visible editor.
              const { runExport } = await import("@/export/runExport");
              const result = await runExport({
                format: job.format as import("@/export/types").ExportFormatId,
                markdownSource:
                  typeof job.markdown === "string" ? job.markdown : "",
                documentPath: job.documentPath ?? null,
                fileName: job.fileName ?? "force-export.md",
                targetPath: job.path,
                onProgress: (message) => {
                  session.statusMessage.value = message;
                  void invokeTauri("write_force_export_status", {
                    message,
                  }).catch(() => undefined);
                },
              });
              session.statusMessage.value = `已导出：${result.fileName}`;
              await invokeTauri("write_force_export_result", {
                payload: JSON.stringify({ ok: true, result }),
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              session.statusMessage.value = `导出失败：${message}`;
              await invokeTauri("write_force_export_result", {
                payload: JSON.stringify({ ok: false, error: message }),
              });
            }
          } catch {
            // Ignore poll errors (command missing / IPC not ready).
          } finally {
            forceExportBusy = false;
          }
        })();
      }, 500);
    }

    // Keep Vite HMR force-export as a secondary path for browser-side debugging.
    if (import.meta.hot) {
      import.meta.hot.on(
        "tomark:force-export",
        async (job: {
          format?: string;
          path?: string;
          markdown?: string;
          fileName?: string;
          documentPath?: string | null;
        }) => {
          const { isTauriIpcReady } = await import("@/native/tauriRuntime");
          if (!isTauriIpcReady()) {
            return;
          }
          const send = (payload: unknown) => {
            import.meta.hot?.send("tomark:force-export-result", payload);
          };
          try {
            if (!job?.format || !job?.path) {
              throw new Error("force-export requires format and path");
            }
            const { runExport } = await import("@/export/runExport");
            const result = await runExport({
              format: job.format as import("@/export/types").ExportFormatId,
              markdownSource:
                typeof job.markdown === "string" ? job.markdown : "",
              documentPath: job.documentPath ?? null,
              fileName: job.fileName ?? "force-export.md",
              targetPath: job.path,
              onProgress: (message) => {
                session.statusMessage.value = message;
              },
            });
            session.statusMessage.value = `已导出：${result.fileName}`;
            send({ ok: true, result });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            session.statusMessage.value = `导出失败：${message}`;
            send({ ok: false, error: message });
          }
        },
      );
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
      const installation = await installAppMenu({
        newDocument: () => {
          void flushPreviewEdits().then(() => session.newDocument());
        },
        openDocument: () => {
          void flushPreviewEdits().then(() => session.openDocument());
        },
        saveAs: () => {
          void flushPreviewEdits().then(() => session.saveAs());
        },
        isBlocked: () =>
          session.saving.value ||
          session.dirtyDialogOpen.value ||
          Boolean(options.isBlocked?.()),
      });
      if (unmounted) {
        installation.dispose();
        return;
      }
      unlistenMenu = installation.dispose;
      fileOpsViaMenu.value = installation.fileOpsViaMenu;
      popupFileMenu.value = installation.popupFileMenu;
    } catch (error) {
      if (unmounted) {
        return;
      }
      fileOpsViaMenu.value = false;
      popupFileMenu.value = null;
      session.statusMessage.value = `未能安装应用菜单：${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (unmounted) {
      return;
    }

    try {
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        await flushPreviewEdits();
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
    if (forceExportTimer != null) {
      window.clearInterval(forceExportTimer);
      forceExportTimer = null;
    }
    unlistenCloseRequested?.();
    unlistenMenu?.();
    popupFileMenu.value = null;
    unlistenAppExitRequested?.();
    unlistenOpenFile?.();
    session.dispose();
    preview.refreshPreview.cancel();
    if (import.meta.env.VITE_WDIO === "1") {
      delete (window as unknown as { __tomarkE2e?: unknown }).__tomarkE2e;
    }
  });

  return { fileOpsViaMenu, popupFileMenu };
}
