<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PreviewAnchor } from "@/shared/types";
import { isLocateModifier } from "@/shared/locateModifier";
import {
  bumpMermaidGeneration,
  currentMermaidGeneration,
} from "@/preview/mermaidGeneration";

const props = defineProps<{
  html: string;
  lineToAnchor: Map<number, PreviewAnchor>;
}>();

const emit = defineEmits<{
  "locate-source": [sourceLine: number];
  "open-link": [url: string];
}>();

const container = ref<HTMLElement | null>(null);
const flashId = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let mermaidReady: Promise<void> = Promise.resolve();
let mermaidReadyResolve: (() => void) | null = null;

function clearFlashTimer() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
}

function beginMermaidCycle() {
  if (mermaidReadyResolve) {
    // Previous cycle already has a waiter; resolve it so locate doesn't hang
    // forever when superseded by a newer html update.
    mermaidReadyResolve();
    mermaidReadyResolve = null;
  }
  mermaidReady = new Promise<void>((resolve) => {
    mermaidReadyResolve = resolve;
  });
}

function finishMermaidCycle() {
  if (mermaidReadyResolve) {
    mermaidReadyResolve();
    mermaidReadyResolve = null;
  }
}

function hasPendingMermaid(root: HTMLElement): boolean {
  // Duplicates hasMermaidBlocks() intentionally: a static import of
  // renderMermaid would pull the mermaid chunk graph into PreviewPane.
  return Boolean(root.querySelector("pre > code.language-mermaid"));
}

async function mountMermaid(generation: number) {
  const root = container.value;
  if (!root) {
    finishMermaidCycle();
    return;
  }
  if (!hasPendingMermaid(root)) {
    finishMermaidCycle();
    return;
  }
  try {
    // Keep mermaid out of this module's static graph; only pull the mount
    // chunk after a diagram fence is present.
    const { mountMermaidDiagrams } = await import("@/preview/mountMermaid");
    if (generation !== currentMermaidGeneration()) {
      return;
    }
    await mountMermaidDiagrams(root, generation);
  } finally {
    if (generation === currentMermaidGeneration()) {
      finishMermaidCycle();
    }
  }
}

function onPreviewClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (!isLocateModifier(event)) {
    const link = target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }
    const rawHref = link.getAttribute("href")?.trim() ?? "";
    const protocol = link.protocol.toLowerCase();
    if (rawHref.startsWith("#")) {
      return;
    }
    // Never let rendered Markdown replace the editor's own webview.
    event.preventDefault();
    if (["http:", "https:", "mailto:", "tel:"].includes(protocol)) {
      emit("open-link", link.href);
    }
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
  // Mermaid SVG height can shift after async mount. Wait for the current
  // cycle; if a newer cycle started while waiting, wait for that one too.
  for (let i = 0; i < 5; i += 1) {
    const waiting = mermaidReady;
    await waiting;
    if (mermaidReady === waiting) {
      break;
    }
  }
  if (!container.value) {
    return;
  }
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

async function refreshMermaid() {
  flashId.value = null;
  clearFlashTimer();
  // Shared counter cancels in-flight renderMermaid work even before the
  // dynamic mount chunk finishes loading.
  const generation = bumpMermaidGeneration();
  beginMermaidCycle();
  await nextTick();
  await mountMermaid(generation);
}

watch(
  () => props.html,
  () => {
    void refreshMermaid();
  },
);

onMounted(() => {
  void refreshMermaid();
});

onBeforeUnmount(() => {
  clearFlashTimer();
  bumpMermaidGeneration();
  finishMermaidCycle();
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
  padding: 10px 28px 48px;
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
