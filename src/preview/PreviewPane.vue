<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { PreviewAnchor } from "@/shared/types";
import { isLocateModifier } from "@/shared/locateModifier";

const props = defineProps<{
  html: string;
  lineToAnchor: Map<number, PreviewAnchor>;
}>();

const emit = defineEmits<{
  "locate-source": [sourceLine: number];
}>();

const container = ref<HTMLElement | null>(null);
const flashId = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;

function clearFlashTimer() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
}

function onPreviewClick(event: MouseEvent) {
  if (!isLocateModifier(event)) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchored = target.closest("[data-source-line]");
  if (!(anchored instanceof HTMLElement)) {
    return;
  }
  const raw = anchored.getAttribute("data-source-line");
  const line = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(line) || line < 1) {
    return;
  }
  event.preventDefault();
  emit("locate-source", line);
}

function onPreviewContextMenu(event: MouseEvent) {
  if (isLocateModifier(event)) {
    event.preventDefault();
  }
}

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
  clearFlashTimer();
  flashTimer = setTimeout(() => {
    flashTimer = null;
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
    clearFlashTimer();
  },
);

onBeforeUnmount(() => {
  clearFlashTimer();
});
</script>

<template>
  <div class="preview-pane">
    <div
      ref="container"
      class="preview-content markdown-body"
      v-html="html"
      @click="onPreviewClick"
      @contextmenu="onPreviewContextMenu"
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
