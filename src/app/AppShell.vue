<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import DirtyConfirmDialog from "@/app/DirtyConfirmDialog.vue";
import EncodingSaveDialog from "@/app/EncodingSaveDialog.vue";
import HelpDrawer from "@/app/HelpDrawer.vue";
import SettingsDrawer from "@/app/SettingsDrawer.vue";
import DefaultAppPrompt from "@/app/DefaultAppPrompt.vue";
import type { EncodingHint } from "@/shared/types";
import { useDocumentSession } from "./useDocumentSession";
import { useAppShortcuts } from "./useAppShortcuts";
import { usePreviewBridge } from "./usePreviewBridge";
import { usePaneSplit } from "./usePaneSplit";
import { useViewMode } from "./useViewMode";
import { useToolbarTitle } from "./useToolbarTitle";
import { useDocumentStats } from "./useDocumentStats";
import { usePaneLocate } from "./usePaneLocate";
import { useShellLifecycle } from "./useShellLifecycle";
import { useDefaultAppSetup } from "./useDefaultAppSetup";
import { isMacOS } from "@/shared/isMacOS";

type ActiveDrawer = "help" | "settings" | null;

const EditorPane = defineAsyncComponent(() => import("@/editor/EditorPane.vue"));
const PreviewPane = defineAsyncComponent(() => import("@/preview/PreviewPane.vue"));

/** macOS Overlay titlebar merges with toolbar; Windows keeps native chrome. */
const macOSOverlayTitlebar = isMacOS();

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

const preview = usePreviewBridge(content);
const previewHtml = preview.html;
const previewLineToAnchor = preview.lineToAnchor;

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
const exportBusy = ref(false);

function openHelp() {
  activeDrawer.value = "help";
}

function openSettings() {
  activeDrawer.value = "settings";
}

function closeDrawer() {
  activeDrawer.value = null;
}

/** Close settings before native save dialog so focus trap cannot block it. */
function onExportBusy(busy: boolean) {
  exportBusy.value = busy;
  if (busy) {
    activeDrawer.value = null;
  }
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
} = usePaneLocate({
  preview,
  isSourceVisible,
  isPreviewVisible,
  viewMode,
  statusMessage,
});

const { fileOpsViaMenu } = useShellLifecycle(
  {
    dirty,
    saving,
    dirtyDialogOpen,
    statusMessage,
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
  },
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

watch(documentVersion, () => {
  void preview.syncNow();
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
      :class="{ 'is-macos-overlay': macOSOverlayTitlebar }"
      data-testid="app-toolbar"
    >
      <span
        v-if="macOSOverlayTitlebar"
        class="toolbar-traffic-spacer"
        aria-hidden="true"
        data-tauri-drag-region
      />
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

    <HelpDrawer
      :open="activeDrawer === 'help'"
      :can-reidentify="!!path"
      @close="closeDrawer"
      @request-default-app="onRequestDefaultApp"
      @reidentify="(hint) => void onReidentify(hint)"
    />

    <SettingsDrawer
      :open="activeDrawer === 'settings'"
      :markdown-source="content"
      :document-path="path"
      :file-name="fileName"
      :busy="exportBusy"
      @close="closeDrawer"
      @export-busy="onExportBusy"
      @status-message="(message) => (statusMessage = message)"
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
