<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  watch,
} from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import DirtyConfirmDialog from "@/app/DirtyConfirmDialog.vue";
import { useDocumentSession } from "./useDocumentSession";
import { useAppShortcuts } from "./useAppShortcuts";
import { usePreviewBridge } from "./usePreviewBridge";

const EditorPane = defineAsyncComponent(() => import("@/editor/EditorPane.vue"));
const PreviewPane = defineAsyncComponent(() => import("@/preview/PreviewPane.vue"));

const {
  path,
  fileName,
  content,
  dirty,
  title,
  documentVersion,
  statusMessage,
  dirtyDialogOpen,
  saving,
  setContent,
  guardDirty,
  newDocument,
  openDocument,
  save,
  saveAs,
  onDirtySave,
  onDirtyDiscard,
  onDirtyCancel,
} = useDocumentSession();

const preview = usePreviewBridge(content);
const previewHtml = preview.html;
const previewLineToAnchor = preview.lineToAnchor;

function setPreviewRef(el: unknown) {
  preview.previewRef.value = el as typeof preview.previewRef.value;
}

watch(
  title,
  (value) => {
    document.title = value;
  },
  { immediate: true },
);

let unlistenCloseRequested: UnlistenFn | null = null;
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
  const appWindow = getCurrentWindow();
  try {
    const unlisten = await appWindow.onCloseRequested(async (event) => {
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
  isBlocked: () => saving.value || dirtyDialogOpen.value,
});

const canSave = computed(() => dirty.value || !path.value);
</script>

<template>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-title">{{ title }}</div>
      <div class="toolbar-actions">
        <button type="button" :disabled="saving" @click="newDocument()">
          新建
        </button>
        <button type="button" :disabled="saving" @click="openDocument()">
          打开
        </button>
        <button
          type="button"
          :disabled="saving || !canSave"
          @click="save()"
        >
          保存
        </button>
        <button type="button" :disabled="saving" @click="saveAs()">
          另存为
        </button>
      </div>
    </header>

    <main class="panes">
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

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-actions button {
  appearance: none;
  border: 1px solid #374151;
  background: #1f2937;
  color: #f9fafb;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.toolbar-actions button:hover:not(:disabled) {
  background: #374151;
}

.toolbar-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.panes {
  display: grid;
  grid-template-columns: 1fr 2fr;
  min-height: 0;
  overflow: hidden;
}

.pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.pane-editor {
  border-right: 1px solid #e5e7eb;
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
