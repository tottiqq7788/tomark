<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { PreviewAnchor } from "@/shared/types";

const props = defineProps<{
  html: string;
  lineToAnchor: Map<number, PreviewAnchor>;
}>();

const container = ref<HTMLElement | null>(null);
const flashId = ref<string | null>(null);

async function scrollToSourceLine(sourceLine: number) {
  const anchor = props.lineToAnchor.get(sourceLine);
  if (!anchor || !container.value) {
    return;
  }
  await nextTick();
  const el = container.value.querySelector(
    `[data-anchor-id="${CSS.escape(anchor.id)}"]`,
  ) as HTMLElement | null;
  if (!el) {
    return;
  }
  container.value
    .querySelectorAll(".preview-flash")
    .forEach((node) => node.classList.remove("preview-flash"));
  el.classList.add("preview-flash");
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  flashId.value = anchor.id;
  window.setTimeout(() => {
    if (flashId.value === anchor.id) {
      el.classList.remove("preview-flash");
      flashId.value = null;
    }
  }, 1200);
}

defineExpose({ scrollToSourceLine });

watch(
  () => props.html,
  () => {
    flashId.value = null;
  },
);
</script>

<template>
  <div class="preview-pane">
    <div
      ref="container"
      class="preview-content markdown-body"
      v-html="html"
    />
  </div>
</template>

<style scoped>
.preview-pane {
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: #fff;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.preview-pane::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.preview-content {
  padding: 20px 28px 48px;
  max-width: 920px;
}

.preview-content :deep([data-anchor-id]) {
  scroll-margin-top: 12px;
}

.preview-content :deep(.preview-flash) {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 4px;
  transition: outline-color 0.2s ease;
}
</style>
