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
import { matchPreviewFormatShortcut } from "@/shared/previewFormatShortcuts";
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
/** Horizontal center of the toolbar (paired with translateX(-50%)). */
const toolbarCenterX = ref(0);
const toolbarRef = ref<{
  root?: HTMLElement | null;
  openLinkEditor?: () => void | Promise<void>;
} | null>(null);
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
/** Keep toolbar visible while the link URL input has focus (selection collapses). */
const linkEditing = ref(false);

/** Fallback before the toolbar has been painted and measured. */
const FALLBACK_TOOLBAR_SIZE = { width: 166, height: 38 };

function measureToolbarSize(): { width: number; height: number } {
  const el = toolbarRef.value?.root ?? null;
  if (!el) {
    return FALLBACK_TOOLBAR_SIZE;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return FALLBACK_TOOLBAR_SIZE;
  }
  return { width: rect.width, height: rect.height };
}

function placeToolbar(rect: PreviewFormatSelection["rect"]) {
  const pos = clampToolbarPosition(rect, measureToolbarSize());
  toolbarTop.value = pos.top;
  toolbarCenterX.value = pos.centerX;
  toolbarVisible.value = true;
  // Remeasure after paint so centering uses the real toolbar width.
  void nextTick(() => {
    requestAnimationFrame(() => {
      if (!toolbarVisible.value || !currentSelection.value) {
        return;
      }
      const refined = clampToolbarPosition(
        currentSelection.value.rect,
        measureToolbarSize(),
      );
      toolbarTop.value = refined.top;
      toolbarCenterX.value = refined.centerX;
    });
  });
}

function clearFlashTimer() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
}

function hideToolbar() {
  toolbarVisible.value = false;
  linkEditing.value = false;
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
  if (suppressSelectionClear || linkEditing.value) {
    return;
  }
  const resolved = resolvePreviewSelection(container.value);
  if (!resolved) {
    hideToolbar();
    return;
  }
  currentSelection.value = resolved;
  toolbarActive.value = { ...resolved.active };
  placeToolbar(resolved.rect);
}

function onLinkEditing(open: boolean) {
  linkEditing.value = open;
  if (open) {
    suppressSelectionClear = true;
  } else {
    suppressSelectionClear = false;
  }
  // Link panel changes toolbar width — re-center on the saved selection.
  if (toolbarVisible.value && currentSelection.value) {
    void nextTick(() => {
      if (currentSelection.value) {
        placeToolbar(currentSelection.value.rect);
      }
    });
  }
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
  placeToolbar(resolved.rect);
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

function onFormatKeyDown(event: KeyboardEvent) {
  if (linkEditing.value) {
    return;
  }
  const action = matchPreviewFormatShortcut(event);
  if (!action || action === "undo" || action === "redo") {
    return;
  }
  // Only when there is an active preview selection (toolbar would be shown).
  if (!toolbarVisible.value || !currentSelection.value) {
    return;
  }
  event.preventDefault();
  if (action === "link") {
    void toolbarRef.value?.openLinkEditor?.();
    return;
  }
  onToggle(action);
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
  window.addEventListener("keydown", onFormatKeyDown, true);
  container.value?.addEventListener("scroll", onScrollOrResize, {
    passive: true,
  });
});

onBeforeUnmount(() => {
  clearFlashTimer();
  document.removeEventListener("selectionchange", onSelectionChange);
  window.removeEventListener("resize", onScrollOrResize);
  window.removeEventListener("keydown", onFormatKeyDown, true);
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
      ref="toolbarRef"
      :visible="toolbarVisible"
      :top="toolbarTop"
      :center-x="toolbarCenterX"
      :active="toolbarActive"
      @toggle="onToggle"
      @apply-link="onApplyLink"
      @remove-link="onRemoveLink"
      @dismiss="onDismissToolbar"
      @link-editing="onLinkEditing"
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
