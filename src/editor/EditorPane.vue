<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createEditor, type EditorHandle } from "./createEditor";

const props = defineProps<{
  modelValue: string;
  documentVersion: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  locate: [sourceLine: number];
}>();

const host = ref<HTMLElement | null>(null);
let editor: EditorHandle | null = null;
let applyingExternal = false;

onMounted(() => {
  if (!host.value) {
    return;
  }
  editor = createEditor({
    parent: host.value,
    doc: props.modelValue,
    onChange: (value) => {
      if (applyingExternal) {
        return;
      }
      emit("update:modelValue", value);
    },
    onLocate: (line) => emit("locate", line),
  });
});

watch(
  () => props.documentVersion,
  () => {
    if (!editor) {
      return;
    }
    applyingExternal = true;
    editor.setDocument(props.modelValue, { collapseHeadings: true });
    applyingExternal = false;
  },
);

onBeforeUnmount(() => {
  editor?.destroy();
  editor = null;
});

function revealSourceLine(line: number) {
  editor?.revealSourceLine(line);
}

function requestMeasure() {
  editor?.requestMeasure();
}

defineExpose({ revealSourceLine, requestMeasure });
</script>

<template>
  <div class="editor-pane">
    <div ref="host" class="editor-host" />
  </div>
</template>

<style scoped>
.editor-pane,
.editor-host {
  height: 100%;
  min-height: 0;
}

.editor-host {
  overflow: hidden;
}

.editor-host :deep(.cm-editor) {
  height: 100%;
  outline: none;
}

.editor-host :deep(.cm-scroller) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.editor-host :deep(.cm-scroller::-webkit-scrollbar) {
  display: none;
  width: 0;
  height: 0;
}
</style>
