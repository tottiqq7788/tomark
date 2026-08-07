<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PreviewAnchor } from "@/shared/types";
import type {
  ActiveFormats,
  InlineFormat,
  PreviewFormatAction,
  PreviewFormatSelection,
} from "@/shared/previewFormatting";
import { isLocateModifier } from "@/shared/locateModifier";
import {
  clampToolbarPosition,
  resolvePreviewSelection,
} from "./previewSelection";
import PreviewFormatToolbar from "./PreviewFormatToolbar.vue";

const props = defineProps<{
  html: string;
  lineToAnchor: Map<number, PreviewAnchor>;
  /** Source that produced `html`; formatting is refused when stale. */
  renderedSource: string | null;
}>();

const emit = defineEmits<{
  "locate-source": [sourceLine: number];
  "open-link": [url: string];
  "format-selection": [
    payload: {
      action: PreviewFormatAction;
      selection: PreviewFormatSelection;
    },
  ];
}>();

const container = ref<HTMLElement | null>(null);
const flashId = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;

const toolbarVisible = ref(false);
const toolbarTop = ref(0);
const toolbarLeft = ref(0);
const toolbarActive = ref<ActiveFormats>({
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  linkHref: null,
  ranges: {},
});
const currentSelection = ref<PreviewFormatSelection | null>(null);
/** Keep selection alive while interacting with the toolbar. */
let suppressSelectionClear = false;

function clearFlashTimer() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
}

function hideToolbar() {
  toolbarVisible.value = false;
  currentSelection.value = null;
  toolbarActive.value = {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: false,
    linkHref: null,
    ranges: {},
  };
}

function refreshToolbarFromSelection() {
  if (suppressSelectionClear) {
    return;
  }
  const resolved = resolvePreviewSelection(container.value);
  if (!resolved) {
    hideToolbar();
    return;
  }
  currentSelection.value = resolved;
  toolbarActive.value = { ...resolved.active };
  const pos = clampToolbarPosition(resolved.rect, { width: 180, height: 40 });
  toolbarTop.value = pos.top;
  toolbarLeft.value = pos.left;
  toolbarVisible.value = true;
}

function onSelectionChange() {
  try {
    refreshToolbarFromSelection();
  } catch {
    hideToolbar();
  }
}

function onPreviewPointerUp(event: PointerEvent) {
  if (isLocateModifier(event)) {
    return;
  }
  // Defer until the browser finalizes the selection.
  window.requestAnimationFrame(() => {
    refreshToolbarFromSelection();
  });
}

function onScrollOrResize() {
  if (!toolbarVisible.value || !currentSelection.value) {
    return;
  }
  const resolved = resolvePreviewSelection(container.value);
  if (!resolved) {
    hideToolbar();
    return;
  }
  currentSelection.value = resolved;
  const pos = clampToolbarPosition(resolved.rect, { width: 180, height: 40 });
  toolbarTop.value = pos.top;
  toolbarLeft.value = pos.left;
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
  hideToolbar();
  emit("locate-source", line);
}

function onPreviewContextMenu(event: MouseEvent) {
  if (isLocateModifier(event)) {
    event.preventDefault();
  }
}

function emitFormat(action: PreviewFormatAction) {
  const selection = currentSelection.value;
  if (!selection) {
    return;
  }
  if (
    props.renderedSource == null ||
    selection.from < 0 ||
    selection.to > props.renderedSource.length
  ) {
    hideToolbar();
    return;
  }
  suppressSelectionClear = true;
  emit("format-selection", { action, selection });
  window.requestAnimationFrame(() => {
    suppressSelectionClear = false;
    hideToolbar();
    window.getSelection()?.removeAllRanges();
  });
}

function onToggle(format: Exclude<InlineFormat, "link">) {
  emitFormat({ type: "toggle", format });
}

function onApplyLink(href: string) {
  emitFormat({ type: "toggle-link", href });
}

function onRemoveLink() {
  emitFormat({ type: "toggle-link" });
}

function onDismissToolbar() {
  hideToolbar();
  window.getSelection()?.removeAllRanges();
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

defineExpose({ scrollToSourceLine, hideFormatToolbar: hideToolbar });

watch(
  () => props.html,
  () => {
    flashId.value = null;
    clearFlashTimer();
    hideToolbar();
  },
);

onMounted(() => {
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("resize", onScrollOrResize);
  container.value?.addEventListener("scroll", onScrollOrResize, {
    passive: true,
  });
});

onBeforeUnmount(() => {
  clearFlashTimer();
  document.removeEventListener("selectionchange", onSelectionChange);
  window.removeEventListener("resize", onScrollOrResize);
  container.value?.removeEventListener("scroll", onScrollOrResize);
});
</script>

<template>
  <div class="preview-pane" @scroll="onScrollOrResize">
    <div
      ref="container"
      class="preview-content markdown-body"
      v-html="html"
      @click="onPreviewClick"
      @contextmenu="onPreviewContextMenu"
      @pointerup="onPreviewPointerUp"
    />
    <PreviewFormatToolbar
      :visible="toolbarVisible"
      :top="toolbarTop"
      :left="toolbarLeft"
      :active="toolbarActive"
      @toggle="onToggle"
      @apply-link="onApplyLink"
      @remove-link="onRemoveLink"
      @dismiss="onDismissToolbar"
    />
  </div>
</template>

<style scoped>
.preview-pane {
  position: relative;
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
