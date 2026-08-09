<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EditableProjection } from "@/markdown/buildEditableProjection";
import type { PreviewFormatSelection } from "@/shared/previewFormatting";
import {
  createPreviewEditSession,
  type PreviewEditSession,
  type PreviewEditStatus,
} from "./usePreviewEditSession";
import type { TaskCheckboxToggleRequest } from "./taskCheckboxToggle";

const props = defineProps<{
  projection: EditableProjection;
  /** Bumps when the host must replace the PM document from source. */
  syncToken: number;
  selectionRecovery?: { anchor: number; head: number } | null;
  getRevision: () => number;
}>();

const emit = defineEmits<{
  status: [status: PreviewEditStatus];
  "selection-change": [selection: PreviewFormatSelection | null];
  "locate-source": [sourceLine: number];
  "open-link": [url: string];
  "toggle-task-checkbox": [request: TaskCheckboxToggleRequest];
}>();

const host = ref<HTMLElement | null>(null);
let session: PreviewEditSession | null = null;
let skipWatch = true;

onMounted(() => {
  if (!host.value) {
    return;
  }
  session = createPreviewEditSession(host.value, props.projection, {
    getRevision: () => props.getRevision(),
    onStatus: (status) => emit("status", status),
    onSelectionChange: (selection) => emit("selection-change", selection),
    onLocateSource: (line) => emit("locate-source", line),
    onOpenLink: (url) => emit("open-link", url),
    onToggleTaskCheckbox: (request) =>
      emit("toggle-task-checkbox", request),
  });
  skipWatch = false;
});

watch(
  () => props.syncToken,
  () => {
    if (skipWatch || !session) {
      return;
    }
    session.rebuild(props.projection, {
      selection: props.selectionRecovery ?? null,
    });
  },
);

onBeforeUnmount(() => {
  session?.destroy();
  session = null;
});

async function scrollToSourceLine(sourceLine: number) {
  await nextTick();
  await session?.scrollToSourceLine(sourceLine);
}

function hideFormatToolbar() {
  emit("selection-change", null);
}

function getFormatSelection(): PreviewFormatSelection | null {
  return session?.syncDomSelection() ?? session?.getFormatSelection() ?? null;
}

function setSourceSelection(anchor: number, head: number): boolean {
  return session?.setSourceSelection(anchor, head) ?? false;
}

function focus() {
  session?.focus();
}

function blur() {
  session?.blur();
}

defineExpose({
  scrollToSourceLine,
  hideFormatToolbar,
  getFormatSelection,
  setSourceSelection,
  focus,
  blur,
});
</script>

<template>
  <div
    ref="host"
    class="preview-editable-host"
    data-testid="preview-editable-host"
  />
</template>

<style scoped>
.preview-editable-host {
  min-height: 100%;
}

.preview-editable-host :deep(.ProseMirror) {
  outline: none;
  min-height: 12em;
  /* white-space / ligatures / word-wrap come from prosemirror.css */
}

.preview-editable-host :deep(.ProseMirror-focused) {
  outline: none;
}
</style>
