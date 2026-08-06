<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import EditorPane from "@/editor/EditorPane.vue";
import PreviewPane from "@/preview/PreviewPane.vue";
import DirtyConfirmDialog from "@/app/DirtyConfirmDialog.vue";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import { debounce } from "@/shared/debounce";
import { useDocumentSession } from "./useDocumentSession";
import type { PreviewAnchor } from "@/shared/types";

const {
  path,
  fileName,
  content,
  dirty,
  title,
  documentVersion,
  statusMessage,
  dirtyDialogOpen,
  setContent,
  newDocument,
  openDocument,
  save,
  saveAs,
  onDirtySave,
  onDirtyDiscard,
  onDirtyCancel,
} = useDocumentSession();

const previewRef = ref<{ scrollToSourceLine: (line: number) => void } | null>(
  null,
);

const html = ref("");
const lineToAnchor = ref<Map<number, PreviewAnchor>>(new Map());

const refreshPreview = debounce((source: string) => {
  const result = renderMarkdown(source);
  html.value = result.html;
  lineToAnchor.value = result.lineToAnchor;
}, 200);

watch(
  content,
  (value) => {
    refreshPreview(value);
  },
  { immediate: true },
);

watch(
  title,
  (value) => {
    document.title = value;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  refreshPreview.cancel();
});

function onLocate(line: number) {
  previewRef.value?.scrollToSourceLine(line);
}

const canSave = computed(() => dirty.value || !path.value);
</script>

<template>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-title">{{ title }}</div>
      <div class="toolbar-actions">
        <button type="button" @click="newDocument()">新建</button>
        <button type="button" @click="openDocument()">打开</button>
        <button type="button" :disabled="!canSave" @click="save()">保存</button>
        <button type="button" @click="saveAs()">另存为</button>
      </div>
    </header>

    <main class="panes">
      <section class="pane pane-editor" aria-label="源码">
        <EditorPane
          :model-value="content"
          :document-version="documentVersion"
          @update:model-value="setContent"
          @locate="onLocate"
        />
      </section>
      <section class="pane pane-preview" aria-label="预览">
        <PreviewPane
          ref="previewRef"
          :html="html"
          :line-to-anchor="lineToAnchor"
        />
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
