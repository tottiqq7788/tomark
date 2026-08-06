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
import { useDocumentSession } from "./useDocumentSession";
import { useAppShortcuts } from "./useAppShortcuts";
import { usePreviewBridge } from "./usePreviewBridge";
import { usePaneSplit } from "./usePaneSplit";

const EditorPane = defineAsyncComponent(() => import("@/editor/EditorPane.vue"));
const PreviewPane = defineAsyncComponent(() => import("@/preview/PreviewPane.vue"));

const {
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
const {
  containerRef,
  dragging,
  gridTemplateColumns,
  startDragging,
  nudgeRatio,
} = usePaneSplit();

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

function setPreviewRef(el: unknown) {
  preview.previewRef.value = el as typeof preview.previewRef.value;
}

function setContainerRef(el: unknown) {
  containerRef.value = el instanceof HTMLElement ? el : null;
}

function onSplitterKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    nudgeRatio(-0.02);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nudgeRatio(0.02);
  }
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
let unmounted = false;
let destroyingWindow = false;

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

  const appWindow = getCurrentWindow();
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
      <div class="toolbar-title">{{ title }}</div>
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
      :class="{ dragging }"
      :style="{ gridTemplateColumns }"
    >
      <section class="pane pane-editor" aria-label="源码">
        <Suspense>
          <EditorPane
            :model-value="content"
            :document-version="documentVersion"
            @update:model-value="setContent"
            @locate="preview.locate"
          />
          <template #fallback>
            <div class="pane-fallback">加载编辑器…</div>
          </template>
        </Suspense>
      </section>
      <div
        class="pane-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整源码与预览宽度"
        tabindex="0"
        @pointerdown="startDragging"
        @keydown="onSplitterKeydown"
      />
      <section class="pane pane-preview" aria-label="预览">
        <Suspense>
          <PreviewPane
            :ref="setPreviewRef"
            :html="previewHtml"
            :line-to-anchor="previewLineToAnchor"
          />
          <template #fallback>
            <div class="pane-fallback">加载预览…</div>
          </template>
        </Suspense>
      </section>
    </main>

    <footer class="status">
      <span>{{ statusMessage || "就绪" }}</span>
      <span v-if="dirty">未保存</span>
    </footer>

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
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  justify-content: space-between;
  gap: 12px;
  padding: 4px 12px;
  font-size: 12px;
  color: #6b7280;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}
</style>
