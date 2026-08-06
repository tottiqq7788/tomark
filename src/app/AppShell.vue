<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import DirtyConfirmDialog from "@/app/DirtyConfirmDialog.vue";
import HelpDrawer from "@/app/HelpDrawer.vue";
import { useDocumentSession } from "./useDocumentSession";
import { useAppShortcuts } from "./useAppShortcuts";
import { usePreviewBridge } from "./usePreviewBridge";
import { usePaneSplit } from "./usePaneSplit";
import { useViewMode } from "./useViewMode";
import {
  computeDocumentStats,
  formatDocumentStats,
} from "@/shared/documentStats";

const EditorPane = defineAsyncComponent(() => import("@/editor/EditorPane.vue"));
const PreviewPane = defineAsyncComponent(() => import("@/preview/PreviewPane.vue"));

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
  saving,
  setContent,
  guardDirty,
  flushAutosave,
  newDocument,
  openDocument,
  save,
  saveAs,
  onDirtySave,
  onDirtyDiscard,
  onDirtyCancel,
  dispose,
} = useDocumentSession();

const preview = usePreviewBridge(content);
const previewHtml = preview.html;
const previewLineToAnchor = preview.lineToAnchor;
const fileOpsViaMenu = ref(false);
const editorPaneRef = ref<{ revealSourceLine: (line: number) => void } | null>(
  null,
);
let pendingRevealLine: number | null = null;
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
    default:
      return "已保存";
  }
});

const documentStats = computed(() => computeDocumentStats(content.value));
const documentStatsLabel = computed(() => formatDocumentStats(documentStats.value));
const helpOpen = ref(false);
const showFullPath = ref(false);

const toolbarLabel = computed(() => {
  const dirtyMark = dirty.value ? " *" : "";
  if (showFullPath.value && path.value) {
    return `${path.value}${dirtyMark}`;
  }
  return `${fileName.value}${dirtyMark}`;
});

const toolbarTitleHint = computed(() => {
  if (!path.value) {
    return "尚未保存到文件，暂无完整路径";
  }
  return showFullPath.value
    ? "点击显示文件名"
    : "点击显示完整路径";
});

function toggleToolbarPath() {
  if (!path.value) {
    statusMessage.value = "尚未保存到文件，暂无完整路径";
    showFullPath.value = false;
    return;
  }
  showFullPath.value = !showFullPath.value;
}

watch(path, () => {
  showFullPath.value = false;
});

watch(
  () => documentVersion.value,
  () => {
    showFullPath.value = false;
  },
);

function setPreviewRef(el: unknown) {
  preview.attachPreview(
    (el as { scrollToSourceLine?: (line: number) => Promise<void> } | null) &&
      typeof (el as { scrollToSourceLine?: unknown }).scrollToSourceLine ===
        "function"
      ? (el as { scrollToSourceLine: (line: number) => Promise<void> })
      : null,
  );
}

function setEditorPaneRef(el: unknown) {
  const pane =
    el &&
    typeof (el as { revealSourceLine?: unknown }).revealSourceLine === "function"
      ? (el as { revealSourceLine: (line: number) => void })
      : null;
  editorPaneRef.value = pane;
  if (pane && pendingRevealLine !== null) {
    const line = pendingRevealLine;
    pendingRevealLine = null;
    pane.revealSourceLine(line);
  }
}

async function onLocateSource(line: number) {
  if (!isSourceVisible.value) {
    statusMessage.value = "当前为渲染视图，请切换到源码或双栏后再定位";
    return;
  }
  pendingRevealLine = null;
  const wasCurrent = preview.isCurrent();
  // Flush debounce so reverse locate uses current source↔anchor mapping.
  const synced = await preview.syncNow();
  if (!synced) {
    return;
  }
  // The clicked line came from the previous DOM; never apply it to new source.
  if (!wasCurrent || !preview.isCurrent()) {
    statusMessage.value = "预览内容已更新，请重新点击定位";
    return;
  }
  if (editorPaneRef.value) {
    editorPaneRef.value.revealSourceLine(line);
  } else {
    pendingRevealLine = line;
  }
}

function onLocatePreview(line: number) {
  if (!isPreviewVisible.value) {
    statusMessage.value = "当前为源码视图，请切换到渲染或双栏后再定位";
    return;
  }
  void preview.locate(line);
}

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

async function onOpenLink(url: string) {
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

let unlistenCloseRequested: UnlistenFn | null = null;
let unlistenMenu: UnlistenFn | null = null;
let unlistenAppExitRequested: UnlistenFn | null = null;
let unmounted = false;
let destroyingWindow = false;
let appExitInFlight = false;

async function onAppExitRequested() {
  if (appExitInFlight || unmounted) {
    return;
  }
  appExitInFlight = true;
  try {
    if (!(await guardDirty()) || unmounted) {
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("confirm_app_exit");
  } catch (error) {
    statusMessage.value = `退出应用失败：${
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
      setContent,
      isDirty: () => dirty.value,
    };
  }

  const [{ isTauri }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/window"),
  ]);
  if (!isTauri() || unmounted) {
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
    statusMessage.value = `未能启用退出保护：${
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
      newDocument,
      openDocument,
      saveAs: () => {
        void saveAs();
      },
      isBlocked: () => saving.value || dirtyDialogOpen.value,
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
    statusMessage.value = `未能安装应用菜单：${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  if (unmounted) {
    return;
  }

  try {
    const unlisten = await appWindow.onCloseRequested(async (event) => {
      await flushAutosave();
      if (!dirty.value) {
        return;
      }
      event.preventDefault();
      if (!(await guardDirty()) || destroyingWindow) {
        return;
      }
      destroyingWindow = true;
      try {
        await appWindow.destroy();
      } catch (error) {
        destroyingWindow = false;
        statusMessage.value = `关闭窗口失败：${
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
    statusMessage.value = `未能启用关闭保护：${
      error instanceof Error ? error.message : String(error)
    }`;
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  unlistenCloseRequested?.();
  unlistenMenu?.();
  unlistenAppExitRequested?.();
  dispose();
  preview.refreshPreview.cancel();
  if (import.meta.env.VITE_WDIO === "1") {
    delete (window as unknown as { __tomarkE2e?: unknown }).__tomarkE2e;
  }
});

useAppShortcuts({
  save: () => {
    void save();
  },
  saveAs: () => {
    void saveAs();
  },
  newDocument,
  openDocument,
  fileOpsViaMenu: () => fileOpsViaMenu.value,
  isBlocked: () => saving.value || dirtyDialogOpen.value,
});
</script>

<template>
  <div class="app-shell">
    <header class="toolbar">
      <button
        type="button"
        class="toolbar-title"
        :class="{ 'is-path': showFullPath && path }"
        :title="toolbarTitleHint"
        :aria-label="toolbarTitleHint"
        @click="toggleToolbarPath"
      >
        {{ toolbarLabel }}
      </button>
      <div
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
    </header>

    <main
      :ref="setContainerRef"
      class="panes"
      :class="{
        dragging: dragging && showSplitter,
        'mode-source': viewMode === 'source',
        'mode-preview': viewMode === 'preview',
        'mode-split': viewMode === 'split',
      }"
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
            :ref="setPreviewRef"
            :html="previewHtml"
            :line-to-anchor="previewLineToAnchor"
            @locate-source="onLocateSource"
            @open-link="onOpenLink"
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
          @click="helpOpen = true"
        >
          ?
        </button>
      </div>
    </footer>

    <HelpDrawer :open="helpOpen" @close="helpOpen = false" />

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
.status-view-mode:hover {
  border-color: #93c5fd;
  color: #1d4ed8;
  background: #eff6ff;
}

.status-help:focus-visible,
.status-view-mode:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
}

.view-mode-icon {
  width: 14px;
  height: 14px;
  display: block;
}
</style>
