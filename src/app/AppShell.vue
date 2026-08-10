<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import DirtyConfirmDialog from "@/app/DirtyConfirmDialog.vue";
import EncodingSaveDialog from "@/app/EncodingSaveDialog.vue";
import SettingsDrawer from "@/app/SettingsDrawer.vue";
import DefaultAppPrompt from "@/app/DefaultAppPrompt.vue";
import {
  DEFAULT_SETTINGS_MENU_ID,
  type SettingsMenuId,
} from "@/app/settings/settingsMenus";
import type { EncodingHint } from "@/shared/types";
import { useDocumentSession } from "./useDocumentSession";
import { useAppShortcuts } from "./useAppShortcuts";
import { usePreviewBridge } from "./usePreviewBridge";
import { usePreviewEditBridge } from "./usePreviewEditBridge";
import { usePaneSplit } from "./usePaneSplit";
import { useViewMode } from "./useViewMode";
import { useToolbarTitle } from "./useToolbarTitle";
import { useDocumentStats } from "./useDocumentStats";
import { usePaneLocate } from "./usePaneLocate";
import { useShellLifecycle } from "./useShellLifecycle";
import { useDefaultAppSetup } from "./useDefaultAppSetup";
import { createEditorPasteImageHandler } from "./useEditorPasteImage";
import { isMacOS } from "@/shared/isMacOS";
import { isWindows } from "@/shared/isWindows";
import { useWindowsTitlebar } from "./useWindowsTitlebar";

type ActiveDrawer = "settings" | null;

const EditorPane = defineAsyncComponent(() => import("@/editor/EditorPane.vue"));
const PreviewPane = defineAsyncComponent(() => import("@/preview/PreviewPane.vue"));

/** Platform window chrome is configured by Tauri's platform-specific config. */
const macOSOverlayTitlebar = isMacOS();
const windowsCustomTitlebar = isWindows();

const {
  path,
  fileName,
  content,
  dirty,
  saveStatus,
  title,
  documentVersion,
  statusMessage,
  dirtyDialogOpen,
  encodingDialogOpen,
  saving,
  setContent,
  guardDirty,
  flushAutosave,
  newDocument,
  openDocument,
  openDocumentAtPath,
  reidentifyDocument,
  save,
  saveAs,
  convertOverwriteUtf8,
  convertSaveAsUtf8,
  openEncodingSaveDialog,
  cancelEncodingSaveDialog,
  onDirtySave,
  onDirtyDiscard,
  onDirtyCancel,
  dispose,
} = useDocumentSession();

const onPasteImage = createEditorPasteImageHandler({
  getDocumentPath: () => path.value,
  ensureDocumentSaved: () => saveAs(),
  showError: async (title, error) => {
    const { showError } = await import("@/native/fileService");
    await showError(title, error);
  },
});

const preview = usePreviewBridge(content);
const previewHtml = preview.html;
const previewLineToAnchor = preview.lineToAnchor;
const previewRenderedSource = preview.renderedSource;
const previewProjection = preview.projection;
const previewRenderMode = preview.renderMode;
const previewEditableSyncToken = preview.editableSyncToken;
const previewSelectionRecovery = preview.selectionRecovery;

const {
  containerRef,
  dragging,
  gridTemplateColumns: splitGridTemplateColumns,
  startDragging,
  nudgeRatio,
} = usePaneSplit();

const {
  mode: viewMode,
  label: viewModeLabel,
  isSourceVisible,
  isPreviewVisible,
  showSplitter,
  cycle: cycleViewMode,
} = useViewMode();

const panesGridTemplateColumns = computed(() => {
  if (!showSplitter.value) {
    return "minmax(0, 1fr)";
  }
  return splitGridTemplateColumns.value;
});

const viewModeHint = computed(
  () => `当前：${viewModeLabel.value}（点击切换）`,
);

const saveStatusLabel = computed(() => {
  switch (saveStatus.value) {
    case "pending":
      return "正在保存…";
    case "unsaved":
      return "未保存到文件";
    case "manual":
      return "保存需处理";
    default:
      return "已保存";
  }
});

async function onReidentify(hint: EncodingHint) {
  activeDrawer.value = null;
  await reidentifyDocument(hint);
}

const { label: documentStatsLabel } = useDocumentStats(content);

const activeDrawer = ref<ActiveDrawer>(null);
const settingsInitialMenu = ref<SettingsMenuId>(DEFAULT_SETTINGS_MENU_ID);
const exportBusy = ref(false);
const settingsDrawerRef = ref<InstanceType<typeof SettingsDrawer> | null>(null);
let resumeSettingsFocusTrap: (() => void) | null = null;

function openHelp() {
  settingsInitialMenu.value = "help";
  activeDrawer.value = "settings";
}

function openSettings() {
  settingsInitialMenu.value = DEFAULT_SETTINGS_MENU_ID;
  activeDrawer.value = "settings";
}

function closeDrawer(expected: Exclude<ActiveDrawer, null>) {
  if (activeDrawer.value === expected) {
    activeDrawer.value = null;
  }
}

/** Keep settings open; only suspend its focus trap for native save / progress UI. */
function onExportBusy(busy: boolean) {
  exportBusy.value = busy;
  if (busy) {
    resumeSettingsFocusTrap?.();
    resumeSettingsFocusTrap =
      settingsDrawerRef.value?.suspendFocusTrap() ?? null;
    return;
  }
  const resume = resumeSettingsFocusTrap;
  resumeSettingsFocusTrap = null;
  resume?.();
}

const {
  open: defaultAppPromptOpen,
  busy: defaultAppBusy,
  statusMessage: defaultAppStatus,
  platformHint: defaultAppHint,
  showPrompt: showDefaultAppPrompt,
  dismissPrompt: dismissDefaultAppPrompt,
  requestDefaultApp,
} = useDefaultAppSetup();

function onRequestDefaultApp() {
  activeDrawer.value = null;
  showDefaultAppPrompt();
}

async function onConfirmDefaultApp() {
  const result = await requestDefaultApp();
  if (result.ok || result.openedSettings) {
    statusMessage.value = result.message;
  }
}

const {
  showFullPath,
  toolbarLabel,
  toolbarTitleHint,
  toggleToolbarPath,
} = useToolbarTitle(path, fileName, dirty, documentVersion, statusMessage);

const {
  setPreviewRef,
  setEditorPaneRef,
  onLocateSource,
  onLocatePreview,
  editorPaneRef,
} = usePaneLocate({
  preview,
  isSourceVisible,
  isPreviewVisible,
  viewMode,
  statusMessage,
  flushPreviewEdit: () => preview.flushEditSession(),
});

const previewPaneApi = ref<{
  selectSourceRange?: (from: number, to: number) => boolean;
  getFormatSelection?: () => {
    from: number;
    to: number;
    expectedText?: string;
    pmFrom?: number;
    pmTo?: number;
  } | null;
  exportMermaidDiagramPngAt?: (
    diagramIndex: number,
    targetPath: string,
  ) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
  exportMermaidDiagramSvgAt?: (
    diagramIndex: number,
    targetPath: string,
  ) => Promise<{ ok: true; fileName: string } | { ok: false; error: string }>;
} | null>(null);

function setPreviewPaneRef(el: unknown) {
  setPreviewRef(el);
  previewPaneApi.value =
    el &&
    typeof (el as { selectSourceRange?: unknown }).selectSourceRange ===
      "function"
      ? (el as {
          selectSourceRange: (from: number, to: number) => boolean;
          getFormatSelection?: () => {
            from: number;
            to: number;
            expectedText?: string;
            pmFrom?: number;
            pmTo?: number;
          } | null;
          exportMermaidDiagramPngAt?: (
            diagramIndex: number,
            targetPath: string,
          ) => Promise<
            { ok: true; fileName: string } | { ok: false; error: string }
          >;
          exportMermaidDiagramSvgAt?: (
            diagramIndex: number,
            targetPath: string,
          ) => Promise<
            { ok: true; fileName: string } | { ok: false; error: string }
          >;
        })
      : null;
}

const editBridge = usePreviewEditBridge({
  getEditor: () => {
    const pane = editorPaneRef.value;
    if (
      !pane ||
      typeof pane.applySourceTransaction !== "function" ||
      typeof pane.getRevision !== "function" ||
      typeof pane.getValue !== "function" ||
      typeof pane.getSelection !== "function" ||
      typeof pane.undo !== "function" ||
      typeof pane.redo !== "function"
    ) {
      return null;
    }
    return {
      applySourceTransaction: pane.applySourceTransaction,
      getRevision: pane.getRevision,
      getValue: pane.getValue,
      getSelection: pane.getSelection,
      undo: pane.undo,
      redo: pane.redo,
      applyFormatChange: pane.applyFormatChange,
    };
  },
  preview,
  statusMessage,
});

const { fileOpsViaMenu, popupFileMenu } = useShellLifecycle(
  {
    dirty,
    saving,
    dirtyDialogOpen,
    statusMessage,
    content,
    documentVersion,
    setContent,
    guardDirty,
    flushAutosave,
    newDocument,
    openDocument,
    openDocumentAtPath,
    saveAs,
    dispose,
  },
  preview,
  {
    isBlocked: () => activeDrawer.value !== null || exportBusy.value,
    exportMermaidDiagramPngAt: (diagramIndex, targetPath) => {
      const api = previewPaneApi.value?.exportMermaidDiagramPngAt;
      if (!api) {
        return Promise.resolve({
          ok: false as const,
          error: "预览未就绪",
        });
      }
      return api(diagramIndex, targetPath);
    },
    exportMermaidDiagramSvgAt: (diagramIndex, targetPath) => {
      const api = previewPaneApi.value?.exportMermaidDiagramSvgAt;
      if (!api) {
        return Promise.resolve({
          ok: false as const,
          error: "预览未就绪",
        });
      }
      return api(diagramIndex, targetPath);
    },
  },
);

const {
  maximized: windowMaximized,
  minimize: minimizeWindow,
  toggleMaximize: toggleMaximizeWindow,
  closeWindow,
  onDragRegionMouseDown,
} = useWindowsTitlebar({
  enabled: windowsCustomTitlebar,
  onError: (message) => {
    statusMessage.value = `窗口操作失败：${message}`;
  },
});

const fileMenuButtonRef = ref<HTMLButtonElement | null>(null);

function setFileMenuButtonRef(element: unknown) {
  fileMenuButtonRef.value =
    element instanceof HTMLButtonElement ? element : null;
}

async function openWindowsFileMenu(target = fileMenuButtonRef.value) {
  const popup = popupFileMenu.value;
  if (!target || !popup) {
    return;
  }
  const rect = target.getBoundingClientRect();
  try {
    await popup(rect.left, rect.bottom);
  } catch (error) {
    statusMessage.value = `未能打开文件菜单：${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function onTitlebarKeydown(event: KeyboardEvent) {
  if (
    windowsCustomTitlebar &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "f"
  ) {
    event.preventDefault();
    void openWindowsFileMenu();
  }
}

onMounted(() => window.addEventListener("keydown", onTitlebarKeydown, true));
onBeforeUnmount(() =>
  window.removeEventListener("keydown", onTitlebarKeydown, true),
);

function onSplitterKeydown(event: KeyboardEvent) {
  if (!showSplitter.value) {
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    nudgeRatio(-0.02);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nudgeRatio(0.02);
  }
}

function isOpenableExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return ["http:", "https:", "mailto:", "tel:"].includes(protocol);
  } catch {
    return false;
  }
}

async function onOpenLink(url: string) {
  // Deny before side effect: only absolute http(s)/mailto/tel reach the opener.
  if (!isOpenableExternalUrl(url)) {
    statusMessage.value = "已拒绝打开不安全链接";
    return;
  }
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    statusMessage.value = `打开链接失败：${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function setContainerRef(el: unknown) {
  containerRef.value = el instanceof HTMLElement ? el : null;
}

watch(
  title,
  (value) => {
    document.title = value;
  },
  { immediate: true },
);

watch(documentVersion, () => {
  void preview.syncNow();
});

if (import.meta.env.VITE_WDIO === "1") {
  onMounted(() => {
    const install = () => {
      const e2e = (
        window as unknown as {
          __tomarkE2e?: {
            formatPreviewRange?: (
              from: number,
              to: number,
              format: "bold" | "italic" | "strike" | "code",
            ) => void;
            selectPreviewRange?: (from: number, to: number) => boolean;
            getPreviewFormatSelection?: () => {
              from: number;
              to: number;
              expectedText?: string;
              pmFrom?: number;
              pmTo?: number;
            } | null;
            triggerSave?: () => void;
            pasteEditorImage?: (
              bytes: number[],
              mime?: string,
            ) => Promise<boolean>;
            pasteEditorScreenshotClipboard?: () => Promise<boolean>;
            openDocumentAtPath?: (filePath: string) => Promise<boolean>;
            getDocumentPath?: () => string | null;
          };
        }
      ).__tomarkE2e;
      if (!e2e) {
        window.requestAnimationFrame(install);
        return;
      }
      e2e.formatPreviewRange = (from, to, format) => {
        void editBridge.onFormatSelection({
          action: { type: "toggle", format },
          selection: {
            from,
            to,
            blockAnchorId: "e2e",
            sourceLine: 1,
            active: {
              bold: false,
              italic: false,
              strike: false,
              code: false,
              link: false,
              linkHref: null,
              ranges: {},
            },
            rect: {
              top: 8,
              left: 8,
              bottom: 24,
              right: 80,
              width: 72,
              height: 16,
            },
            expectedText: preview.renderedSource.value?.slice(from, to),
          },
        });
      };
      e2e.selectPreviewRange = (from, to) => {
        return previewPaneApi.value?.selectSourceRange?.(from, to) ?? false;
      };
      e2e.getPreviewFormatSelection = () => {
        return previewPaneApi.value?.getFormatSelection?.() ?? null;
      };
      e2e.triggerSave = () => {
        void save();
      };
      e2e.pasteEditorImage = async (bytes, mime = "image/png") => {
        const pane = editorPaneRef.value;
        if (!pane?.pasteImageFile) {
          return false;
        }
        const file = new File([new Uint8Array(bytes)], "e2e-paste.png", {
          type: mime,
        });
        return pane.pasteImageFile(file);
      };
      e2e.pasteEditorScreenshotClipboard = async () => {
        const pane = editorPaneRef.value;
        if (!pane?.pasteScreenshotLikeClipboard) {
          return false;
        }
        return pane.pasteScreenshotLikeClipboard();
      };
      e2e.openDocumentAtPath = (filePath) => openDocumentAtPath(filePath);
      e2e.getDocumentPath = () => path.value;
    };
    install();
  });
}

useAppShortcuts({
  save: () => {
    void save();
  },
  saveAs: () => {
    void saveAs();
  },
  newDocument,
  openDocument,
  undo: editBridge.undoEdit,
  redo: editBridge.redoEdit,
  fileOpsViaMenu: () => fileOpsViaMenu.value,
  isBlocked: () =>
    saving.value ||
    dirtyDialogOpen.value ||
    encodingDialogOpen.value ||
    activeDrawer.value !== null ||
    exportBusy.value,
});
</script>

<template>
  <div class="app-shell">
    <header
      class="toolbar"
      :class="{
        'is-macos-overlay': macOSOverlayTitlebar,
        'is-windows-custom': windowsCustomTitlebar,
      }"
      data-testid="app-toolbar"
    >
      <span
        v-if="macOSOverlayTitlebar"
        class="toolbar-traffic-spacer"
        aria-hidden="true"
        data-tauri-drag-region
      />
      <span
        v-if="windowsCustomTitlebar"
        class="toolbar-app-icon"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16">
          <rect x="1" y="1" width="14" height="14" rx="3" />
          <path d="M4 4.5h8M4 7.5h8M4 10.5h5" />
        </svg>
      </span>
      <button
        v-if="windowsCustomTitlebar"
        :ref="setFileMenuButtonRef"
        type="button"
        class="toolbar-file-menu"
        aria-label="文件菜单"
        data-testid="windows-file-menu"
        @click="openWindowsFileMenu($event.currentTarget as HTMLButtonElement)"
      >
        文件
      </button>
      <button
        type="button"
        class="toolbar-title"
        :class="{ 'is-path': showFullPath && path }"
        :title="toolbarTitleHint"
        :aria-label="toolbarTitleHint"
        data-testid="toolbar-title"
        @click="toggleToolbarPath"
      >
        {{ toolbarLabel }}
      </button>
      <span
        v-if="macOSOverlayTitlebar"
        class="toolbar-drag-region"
        aria-hidden="true"
        data-tauri-drag-region
        data-testid="toolbar-drag-region"
      />
      <button
        v-if="saveStatus === 'manual'"
        type="button"
        class="toolbar-save-status is-manual"
        data-status="manual"
        data-testid="save-status-manual"
        :title="saveStatusLabel"
        :aria-label="saveStatusLabel"
        @click="openEncodingSaveDialog"
      >
        <svg
          class="save-icon save-icon-manual"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
          <path
            d="M8 4.2v5.2M8 11.4h.01"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <div
        v-else
        class="toolbar-save-status"
        :data-status="saveStatus"
        :title="saveStatusLabel"
        :aria-label="saveStatusLabel"
        role="status"
      >
        <svg
          v-if="saveStatus === 'saved'"
          class="save-icon save-icon-saved"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
          <path
            d="M4.2 8.2 6.7 10.7 11.8 5.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          v-else-if="saveStatus === 'pending'"
          class="save-icon save-icon-pending"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-dasharray="28 12"
          />
        </svg>
        <svg
          v-else
          class="save-icon save-icon-unsaved"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
          <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        </svg>
      </div>
      <span
        v-if="windowsCustomTitlebar"
        class="toolbar-windows-drag-region"
        aria-hidden="true"
        data-testid="windows-drag-region"
        @mousedown="onDragRegionMouseDown"
      />
      <div
        v-if="windowsCustomTitlebar"
        class="toolbar-window-controls"
        data-testid="windows-window-controls"
      >
        <button
          type="button"
          class="toolbar-window-control"
          aria-label="最小化"
          title="最小化"
          data-testid="window-minimize"
          @click="minimizeWindow"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 8.5h8" />
          </svg>
        </button>
        <button
          type="button"
          class="toolbar-window-control"
          :aria-label="windowMaximized ? '还原' : '最大化'"
          :title="windowMaximized ? '还原' : '最大化'"
          data-testid="window-maximize"
          @click="toggleMaximizeWindow"
        >
          <svg v-if="windowMaximized" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3.5 4.5h5v5h-5zM5 4.5V3h4v4H8.5" />
          </svg>
          <svg v-else viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" />
          </svg>
        </button>
        <button
          type="button"
          class="toolbar-window-control is-close"
          aria-label="关闭"
          title="关闭"
          data-testid="window-close"
          @click="closeWindow"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="m2.5 2.5 7 7m0-7-7 7" />
          </svg>
        </button>
      </div>
    </header>

    <main
      :ref="setContainerRef"
      class="panes"
      :class="{ dragging: dragging && showSplitter }"
      :style="{ gridTemplateColumns: panesGridTemplateColumns }"
    >
      <section
        v-show="isSourceVisible"
        class="pane pane-editor"
        aria-label="源码"
      >
        <Suspense>
          <EditorPane
            :ref="setEditorPaneRef"
            :model-value="content"
            :document-version="documentVersion"
            :paste-image="onPasteImage"
            @update:model-value="setContent"
            @locate="onLocatePreview"
          />
          <template #fallback>
            <div class="pane-fallback">加载编辑器…</div>
          </template>
        </Suspense>
      </section>
      <div
        v-if="showSplitter"
        class="pane-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整源码与预览宽度"
        tabindex="0"
        @pointerdown="startDragging"
        @keydown="onSplitterKeydown"
      />
      <section
        v-show="isPreviewVisible"
        class="pane pane-preview"
        aria-label="预览"
      >
        <Suspense>
          <PreviewPane
            :ref="setPreviewPaneRef"
            :html="previewHtml"
            :line-to-anchor="previewLineToAnchor"
            :rendered-source="previewRenderedSource"
            :projection="previewProjection"
            :render-mode="previewRenderMode"
            :editable-sync-token="previewEditableSyncToken"
            :selection-recovery="previewSelectionRecovery"
            :get-revision="editBridge.getRevision"
            :file-name="fileName"
            :document-path="path"
            @locate-source="onLocateSource"
            @open-link="onOpenLink"
            @format-selection="editBridge.onFormatSelection"
            @toggle-task-checkbox="editBridge.onToggleTaskCheckbox"
            @edit-status="editBridge.onEditStatus"
            @status="statusMessage = $event"
          />
          <template #fallback>
            <div class="pane-fallback">加载预览…</div>
          </template>
        </Suspense>
      </section>
    </main>

    <footer class="status">
      <div class="status-left">
        <span>{{ statusMessage || "就绪" }}</span>
        <span v-if="dirty" class="status-dirty">未保存</span>
      </div>
      <div class="status-right">
        <span class="status-stats" :title="documentStatsLabel">
          {{ documentStatsLabel }}
        </span>
        <button
          type="button"
          class="status-view-mode"
          :aria-label="viewModeHint"
          :title="viewModeHint"
          @click="cycleViewMode"
        >
          <!-- 源码：仅左栏 -->
          <svg
            v-if="viewMode === 'source'"
            class="view-mode-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="2"
              width="13"
              height="12"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
            />
            <rect x="2.6" y="3.2" width="5.2" height="9.6" rx="0.6" fill="currentColor" />
          </svg>
          <!-- 源码/渲染：双栏 -->
          <svg
            v-else-if="viewMode === 'split'"
            class="view-mode-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="2"
              width="13"
              height="12"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
            />
            <rect x="2.6" y="3.2" width="4.4" height="9.6" rx="0.6" fill="currentColor" />
            <rect
              x="9"
              y="3.2"
              width="4.4"
              height="9.6"
              rx="0.6"
              fill="currentColor"
              opacity="0.35"
            />
          </svg>
          <!-- 渲染：仅右栏 -->
          <svg
            v-else
            class="view-mode-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="2"
              width="13"
              height="12"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
            />
            <rect x="8.2" y="3.2" width="5.2" height="9.6" rx="0.6" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          class="status-help"
          aria-label="使用说明"
          title="使用说明"
          data-testid="status-help"
          @click="openHelp"
        >
          ?
        </button>
        <button
          type="button"
          class="status-settings"
          aria-label="设置"
          title="设置"
          data-testid="status-settings"
          @click="openSettings"
        >
          <svg class="settings-icon" viewBox="0 0 16 16" aria-hidden="true">
            <!-- Compact 6-tooth gear; evenodd cutout stays sharp at 14px -->
            <path
              fill="currentColor"
              fill-rule="evenodd"
              d="M8.7 1.4c.25 0 .48.16.56.4l.24.9c.44.14.84.36 1.2.64l.86-.38c.23-.1.5-.03.66.17l.58 1c.15.24.1.55-.1.72l-.74.62c.2.4.34.84.4 1.3l.94.22c.26.06.44.3.44.56v1.16c0 .26-.18.5-.44.56l-.94.22a4.1 4.1 0 0 1-.4 1.3l.74.62c.2.17.25.48.1.72l-.58 1c-.16.2-.43.27-.66.17l-.86-.38c-.36.28-.76.5-1.2.64l-.24.9a.6.6 0 0 1-.56.4H7.3a.6.6 0 0 1-.56-.4l-.24-.9a4.1 4.1 0 0 1-1.2-.64l-.86.38c-.23.1-.5.03-.66-.17l-.58-1a.6.6 0 0 1 .1-.72l.74-.62a4.1 4.1 0 0 1-.4-1.3l-.94-.22A.6.6 0 0 1 1.4 8.58V7.42c0-.26.18-.5.44-.56l.94-.22c.06-.46.2-.9.4-1.3l-.74-.62a.6.6 0 0 1-.1-.72l.58-1c.16-.2.43-.27.66-.17l.86.38c.36-.28.76-.5 1.2-.64l.24-.9a.6.6 0 0 1 .56-.4h1.4ZM8 5.85a2.15 2.15 0 1 0 0 4.3 2.15 2.15 0 0 0 0-4.3Z"
            />
          </svg>
        </button>
      </div>
    </footer>

    <SettingsDrawer
      ref="settingsDrawerRef"
      :open="activeDrawer === 'settings'"
      :initial-menu="settingsInitialMenu"
      :markdown-source="content"
      :document-path="path"
      :file-name="fileName"
      :busy="exportBusy"
      :can-reidentify="!!path"
      @close="closeDrawer('settings')"
      @export-busy="onExportBusy"
      @request-default-app="onRequestDefaultApp"
      @reidentify="(hint) => void onReidentify(hint)"
    />

    <DefaultAppPrompt
      :open="defaultAppPromptOpen"
      :busy="defaultAppBusy"
      :platform-hint="defaultAppHint"
      :status-message="defaultAppStatus"
      @later="dismissDefaultAppPrompt"
      @confirm="void onConfirmDefaultApp()"
    />

    <EncodingSaveDialog
      :open="encodingDialogOpen"
      :busy="saving"
      @overwrite="void convertOverwriteUtf8()"
      @save-as="void convertSaveAsUtf8()"
      @cancel="cancelEncodingSaveDialog"
    />

    <DirtyConfirmDialog
      :open="dirtyDialogOpen"
      title="未保存的更改"
      :message="`「${fileName}」有未保存的更改，要先保存吗？`"
      :busy="saving"
      @save="onDirtySave"
      @discard="onDirtyDiscard"
      @cancel="onDirtyCancel"
    />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  min-width: 800px;
  background: #f3f4f6;
  color: #111827;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 12px;
  background: #111827;
  color: #f9fafb;
  border-bottom: 1px solid #1f2937;
}

.toolbar.is-macos-overlay {
  gap: 8px;
  /* Match default traffic-light inset (~9–22px); 32px bar centers them. */
  padding: 0 10px 0 0;
  min-height: 32px;
  height: 32px;
  box-sizing: border-box;
}

.toolbar.is-windows-custom {
  justify-content: flex-start;
  gap: 0;
  height: 32px;
  min-height: 32px;
  padding: 0;
  box-sizing: border-box;
  user-select: none;
}

.toolbar-app-icon {
  flex: 0 0 32px;
  display: grid;
  place-items: center;
  align-self: stretch;
}

.toolbar-app-icon svg {
  width: 16px;
  height: 16px;
  fill: #334155;
  stroke: #f8fafc;
  stroke-width: 1.2;
  stroke-linecap: round;
}

.toolbar-file-menu {
  align-self: stretch;
  min-width: 48px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: default;
}

.toolbar-file-menu:hover,
.toolbar-file-menu:focus-visible,
.toolbar-window-control:hover,
.toolbar-window-control:focus-visible {
  background: rgba(255, 255, 255, 0.1);
  outline: none;
}

.toolbar.is-windows-custom .toolbar-title {
  flex: 0 1 auto;
  max-width: min(55%, 560px);
  padding: 0 8px;
  border-radius: 0;
  line-height: 32px;
}

.toolbar.is-windows-custom .toolbar-save-status {
  width: 24px;
  height: 32px;
}

.toolbar-windows-drag-region {
  flex: 1 1 48px;
  align-self: stretch;
  min-width: 24px;
}

.toolbar-window-controls {
  flex: 0 0 auto;
  display: flex;
  align-self: stretch;
}

.toolbar-window-control {
  display: grid;
  place-items: center;
  width: 46px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: default;
}

.toolbar-window-control svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.toolbar-window-control.is-close:hover,
.toolbar-window-control.is-close:focus-visible {
  background: #c42b1c;
  color: #fff;
}

.toolbar-traffic-spacer {
  flex: 0 0 72px;
  align-self: stretch;
  min-height: 100%;
}

.toolbar-drag-region {
  flex: 1 1 auto;
  align-self: stretch;
  min-width: 24px;
  min-height: 100%;
}

.toolbar.is-macos-overlay .toolbar-title {
  flex: 0 1 auto;
  max-width: min(60%, 520px);
  padding: 0 6px;
  font-size: 13px;
  line-height: 1.2;
}

.toolbar.is-macos-overlay .toolbar-save-status {
  width: 18px;
  height: 18px;
}

.toolbar.is-macos-overlay .save-icon {
  width: 14px;
  height: 14px;
}

.toolbar-title {
  min-width: 0;
  flex: 1;
  margin: 0;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: ltr;
  cursor: pointer;
}

.toolbar-title.is-path {
  direction: rtl;
  text-align: left;
}

.toolbar-title:hover {
  background: rgba(255, 255, 255, 0.06);
}

.toolbar-title:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}

.toolbar-save-status {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
}

.toolbar-save-status.is-manual {
  border-radius: 6px;
  cursor: pointer;
}

.toolbar-save-status.is-manual:hover {
  background: rgba(255, 255, 255, 0.08);
}

.toolbar-save-status.is-manual:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}

.save-icon {
  width: 16px;
  height: 16px;
  display: block;
}

.save-icon-saved {
  color: #22c55e;
}

.save-icon-pending {
  color: #eab308;
  animation: save-spin 0.9s linear infinite;
}

.save-icon-unsaved {
  color: #eab308;
}

.save-icon-manual {
  color: #f97316;
}

@keyframes save-spin {
  to {
    transform: rotate(360deg);
  }
}

.panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6px minmax(0, 2fr);
  min-height: 0;
  overflow: hidden;
}

.panes.dragging {
  cursor: col-resize;
}

.pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.pane-splitter {
  position: relative;
  z-index: 1;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: #e5e7eb;
  cursor: col-resize;
  touch-action: none;
}

.pane-splitter::before {
  content: "";
  position: absolute;
  inset: 0 -3px;
}

.pane-splitter:hover,
.panes.dragging .pane-splitter,
.pane-splitter:focus-visible {
  background: #93c5fd;
}

.pane-splitter:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
}

.pane-fallback {
  display: grid;
  place-items: center;
  height: 100%;
  color: #6b7280;
  font-size: 13px;
}

.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 10px 3px 12px;
  font-size: 12px;
  color: #6b7280;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  min-height: 26px;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-left {
  flex: 1;
}

.status-dirty {
  color: #b45309;
  flex-shrink: 0;
}

.status-stats {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: #4b5563;
}

.status-help,
.status-settings,
.status-view-mode {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #fff;
  color: #4b5563;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}

.status-help:hover,
.status-settings:hover,
.status-view-mode:hover {
  border-color: #93c5fd;
  color: #1d4ed8;
  background: #eff6ff;
}

.status-help:focus-visible,
.status-settings:focus-visible,
.status-view-mode:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
}

.view-mode-icon,
.settings-icon {
  width: 14px;
  height: 14px;
  display: block;
}
</style>
