<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PreviewAnchor } from "@/shared/types";
import type { EditableProjection } from "@/markdown/buildEditableProjection";
import type {
  ApplySourceTransactionResult,
  SourcePatchTransaction,
} from "@/shared/previewEditing";
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
import PreviewEditableHost from "./editing/PreviewEditableHost.vue";
import type { PreviewEditStatus } from "./editing/usePreviewEditSession";
import "./editing/editablePreview.css";

const props = defineProps<{
  html: string;
  lineToAnchor: Map<number, PreviewAnchor>;
  /** Source that produced the current preview; formatting is refused when stale. */
  renderedSource: string | null;
  projection: EditableProjection | null;
  renderMode: "editable" | "fallback";
  editableSyncToken: number;
  selectionRecovery?: { anchor: number; head: number } | null;
  getRevision: () => number;
  applySourceTransaction: (
    transaction: SourcePatchTransaction,
  ) => ApplySourceTransactionResult;
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
  "edit-status": [status: PreviewEditStatus];
  "composing-change": [composing: boolean];
}>();

const scrollRoot = ref<HTMLElement | null>(null);
const fallbackContainer = ref<HTMLElement | null>(null);
const editableHost = ref<{
  scrollToSourceLine: (line: number) => Promise<void>;
  hideFormatToolbar: () => void;
  flushComposition: () => void;
  isComposing: () => boolean;
  getFormatSelection: () => PreviewFormatSelection | null;
  setSourceSelection: (anchor: number, head: number) => boolean;
  focus: () => void;
} | null>(null);

const flashId = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;

const toolbarVisible = ref(false);
const toolbarTop = ref(0);
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
let suppressSelectionClear = false;
const linkEditing = ref(false);

const useEditable = computed(
  () => props.renderMode === "editable" && props.projection != null,
);

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

function applyResolvedSelection(resolved: PreviewFormatSelection | null) {
  if (suppressSelectionClear || linkEditing.value) {
    return;
  }
  if (!resolved) {
    // Keep the last selection while the floating toolbar holds pointer focus.
    const active = document.activeElement;
    if (
      toolbarVisible.value &&
      active instanceof Element &&
      active.closest('[data-testid="preview-format-toolbar"]')
    ) {
      return;
    }
    hideToolbar();
    return;
  }
  currentSelection.value = resolved;
  toolbarActive.value = { ...resolved.active };
  placeToolbar(resolved.rect);
}

function onToolbarPointerDown() {
  suppressSelectionClear = true;
}

function onToolbarPointerUp() {
  window.requestAnimationFrame(() => {
    suppressSelectionClear = linkEditing.value;
  });
}

function onEditableSelectionChange(selection: PreviewFormatSelection | null) {
  applyResolvedSelection(selection);
}

function refreshFallbackToolbarFromSelection() {
  if (useEditable.value || suppressSelectionClear || linkEditing.value) {
    return;
  }
  const resolved = resolvePreviewSelection(fallbackContainer.value);
  applyResolvedSelection(resolved);
}

function onSelectionChange() {
  try {
    if (useEditable.value) {
      window.requestAnimationFrame(() => {
        applyResolvedSelection(
          editableHost.value?.getFormatSelection() ?? null,
        );
      });
      return;
    }
    refreshFallbackToolbarFromSelection();
  } catch {
    hideToolbar();
  }
}

function onFallbackPointerUp(event: PointerEvent) {
  if (useEditable.value || isLocateModifier(event)) {
    return;
  }
  window.requestAnimationFrame(() => {
    refreshFallbackToolbarFromSelection();
  });
}

function onLinkEditing(open: boolean) {
  linkEditing.value = open;
  suppressSelectionClear = open;
  if (toolbarVisible.value && currentSelection.value) {
    void nextTick(() => {
      if (currentSelection.value) {
        placeToolbar(currentSelection.value.rect);
      }
    });
  }
}

function onScrollOrResize() {
  if (!toolbarVisible.value || !currentSelection.value) {
    return;
  }
  if (useEditable.value) {
    const resolved = editableHost.value?.getFormatSelection() ?? null;
    if (!resolved) {
      hideToolbar();
      return;
    }
    currentSelection.value = resolved;
    placeToolbar(resolved.rect);
    return;
  }
  const resolved = resolvePreviewSelection(fallbackContainer.value);
  if (!resolved) {
    hideToolbar();
    return;
  }
  currentSelection.value = resolved;
  placeToolbar(resolved.rect);
}

function onFallbackClick(event: MouseEvent) {
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

function onFallbackContextMenu(event: MouseEvent) {
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
}

function onFormatKeyDown(event: KeyboardEvent) {
  if (linkEditing.value) {
    return;
  }
  const action = matchPreviewFormatShortcut(event);
  if (!action || action === "undo" || action === "redo") {
    return;
  }
  if (!currentSelection.value) {
    const resolved = useEditable.value
      ? editableHost.value?.getFormatSelection() ?? null
      : resolvePreviewSelection(fallbackContainer.value);
    if (resolved) {
      applyResolvedSelection(resolved);
    }
  }
  if (!currentSelection.value) {
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
  if (useEditable.value && editableHost.value) {
    await editableHost.value.scrollToSourceLine(sourceLine);
    return;
  }
  const anchor = props.lineToAnchor.get(sourceLine);
  if (!anchor || !fallbackContainer.value) {
    return;
  }
  await nextTick();
  const el = fallbackContainer.value.querySelector(
    `[data-anchor-id="${CSS.escape(anchor.id)}"]`,
  ) as HTMLElement | null;
  if (!el) {
    return;
  }
  fallbackContainer.value
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

function hideFormatToolbar() {
  hideToolbar();
  editableHost.value?.hideFormatToolbar();
}

function flushComposition() {
  editableHost.value?.flushComposition();
}

function isComposing(): boolean {
  return editableHost.value?.isComposing() ?? false;
}

/** Place a source-offset selection and show the format toolbar when non-empty. */
function selectSourceRange(from: number, to: number): boolean {
  if (!useEditable.value || !editableHost.value) {
    return false;
  }
  const ok = editableHost.value.setSourceSelection(from, to);
  if (!ok) {
    return false;
  }
  applyResolvedSelection(editableHost.value.getFormatSelection());
  return currentSelection.value != null;
}

defineExpose({
  scrollToSourceLine,
  hideFormatToolbar,
  flushComposition,
  isComposing,
  selectSourceRange,
});

watch(
  () => [props.html, props.editableSyncToken, props.renderMode] as const,
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
  scrollRoot.value?.addEventListener("scroll", onScrollOrResize, {
    passive: true,
  });
});

onBeforeUnmount(() => {
  clearFlashTimer();
  document.removeEventListener("selectionchange", onSelectionChange);
  window.removeEventListener("resize", onScrollOrResize);
  window.removeEventListener("keydown", onFormatKeyDown, true);
  scrollRoot.value?.removeEventListener("scroll", onScrollOrResize);
});
</script>

<template>
  <div ref="scrollRoot" class="preview-pane" @scroll="onScrollOrResize">
    <PreviewEditableHost
      v-if="useEditable && projection"
      ref="editableHost"
      class="preview-content"
      :projection="projection"
      :sync-token="editableSyncToken"
      :selection-recovery="selectionRecovery"
      :get-revision="getRevision"
      :apply-source-transaction="applySourceTransaction"
      @status="emit('edit-status', $event)"
      @selection-change="onEditableSelectionChange"
      @composing-change="emit('composing-change', $event)"
      @locate-source="emit('locate-source', $event)"
      @open-link="emit('open-link', $event)"
    />
    <div
      v-else
      ref="fallbackContainer"
      class="preview-content markdown-body"
      data-testid="preview-html-fallback"
      v-html="html"
      @click="onFallbackClick"
      @contextmenu="onFallbackContextMenu"
      @pointerup="onFallbackPointerUp"
    />
    <PreviewFormatToolbar
      ref="toolbarRef"
      :visible="toolbarVisible"
      :top="toolbarTop"
      :center-x="toolbarCenterX"
      :active="toolbarActive"
      @pointerdown="onToolbarPointerDown"
      @pointerup="onToolbarPointerUp"
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

.preview-content :deep([data-anchor-id]),
.preview-content :deep(.preview-flash) {
  scroll-margin-top: 12px;
}

.preview-content :deep(.preview-flash) {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 4px;
  transition: outline-color 0.2s ease;
}
</style>
