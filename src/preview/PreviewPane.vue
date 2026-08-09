<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PreviewAnchor } from "@/shared/types";
import type { EditableProjection } from "@/markdown/buildEditableProjection";
import type {
  ActiveFormats,
  InlineFormat,
  PreviewFormatAction,
  PreviewFormatSelection,
} from "@/shared/previewFormatting";
import { isLocateModifier } from "@/shared/locateModifier";
import { matchPreviewFormatShortcut } from "@/shared/previewFormatShortcuts";
import {
  bumpMermaidGeneration,
  currentMermaidGeneration,
} from "@/preview/mermaidGeneration";
import {
  getMermaidDiagramContext,
  resolveMermaidDiagramFromTarget,
} from "@/preview/mermaidDiagramRegistry";
import {
  ExportCancelledError,
  ExportFailedError,
} from "@/export/types";
import {
  clampToolbarPosition,
  resolvePreviewSelection,
} from "./previewSelection";
import PreviewFormatToolbar from "./PreviewFormatToolbar.vue";
import MermaidDiagramToolbar from "./MermaidDiagramToolbar.vue";
import MermaidFullscreenViewer from "./MermaidFullscreenViewer.vue";
import PreviewEditableHost from "./editing/PreviewEditableHost.vue";
import type { PreviewEditStatus } from "./editing/usePreviewEditSession";
import "./editing/editablePreview.css";

const props = withDefaults(
  defineProps<{
    html: string;
    lineToAnchor: Map<number, PreviewAnchor>;
    /** Source that produced the current preview; formatting is refused when stale. */
    renderedSource: string | null;
    projection: EditableProjection | null;
    renderMode: "editable" | "fallback";
    editableSyncToken: number;
    selectionRecovery?: { anchor: number; head: number } | null;
    getRevision: () => number;
    /** Document file name used for single-diagram PNG suggestions. */
    fileName?: string;
  }>(),
  {
    fileName: "untitled.md",
  },
);

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
  status: [message: string];
}>();

const scrollRoot = ref<HTMLElement | null>(null);
const fallbackContainer = ref<HTMLElement | null>(null);
const editableHost = ref<{
  scrollToSourceLine: (line: number) => Promise<void>;
  hideFormatToolbar: () => void;
  getFormatSelection: () => PreviewFormatSelection | null;
  setSourceSelection: (anchor: number, head: number) => boolean;
  focus: () => void;
  blur: () => void;
} | null>(null);

const flashId = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let mermaidReady: Promise<void> = Promise.resolve();
let mermaidReadyResolve: (() => void) | null = null;

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
/** Range frozen when the toolbar is armed — survives PM/DOM drift before click. */
const formatSelectionSnapshot = ref<PreviewFormatSelection | null>(null);
let suppressSelectionClear = false;
const linkEditing = ref(false);

const mermaidToolbarVisible = ref(false);
const mermaidToolbarTop = ref(0);
const mermaidToolbarCenterX = ref(0);
const mermaidToolbarRef = ref<{ root?: HTMLElement | null } | null>(null);
const mermaidTarget = ref<HTMLElement | null>(null);
const mermaidSourceSnapshot = ref("");
const mermaidSvgSnapshot = ref("");
const mermaidDiagramIndex = ref(1);
const mermaidExportBusy = ref(false);
const mermaidViewerOpen = ref(false);
const mermaidFullscreenBtn = ref<HTMLElement | null>(null);
let mermaidTargetObserver: MutationObserver | null = null;

const useEditable = computed(
  () => props.renderMode === "editable" && props.projection != null,
);

const FALLBACK_TOOLBAR_SIZE = { width: 166, height: 38 };
const MERMAID_TOOLBAR_SIZE = { width: 72, height: 38 };

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
  hideMermaidToolbar();
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

function measureMermaidToolbarSize(): { width: number; height: number } {
  const el = mermaidToolbarRef.value?.root ?? null;
  if (!el) {
    return MERMAID_TOOLBAR_SIZE;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return MERMAID_TOOLBAR_SIZE;
  }
  return { width: rect.width, height: rect.height };
}

function disconnectMermaidTargetObserver() {
  mermaidTargetObserver?.disconnect();
  mermaidTargetObserver = null;
}

function hideMermaidToolbar(options?: { keepViewer?: boolean }) {
  mermaidToolbarVisible.value = false;
  mermaidTarget.value = null;
  // Keep source/SVG snapshots while the fullscreen viewer is still open so
  // export from the viewer does not lose the authoritative fence body.
  if (!options?.keepViewer) {
    mermaidSourceSnapshot.value = "";
    mermaidSvgSnapshot.value = "";
    mermaidViewerOpen.value = false;
  }
  disconnectMermaidTargetObserver();
}

function diagramIndexAmongSuccess(wrapper: HTMLElement): number {
  const root = scrollRoot.value;
  if (!root) {
    return 1;
  }
  const all = root.querySelectorAll(
    ".mermaid-diagram[data-mermaid='1']:not([data-mermaid-error])",
  );
  let index = 1;
  for (const node of all) {
    if (node === wrapper) {
      return index;
    }
    index += 1;
  }
  return 1;
}

function placeMermaidToolbar(wrapper: HTMLElement) {
  const rect = wrapper.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    hideMermaidToolbar({ keepViewer: mermaidViewerOpen.value });
    return;
  }
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  if (
    rect.bottom < 0 ||
    rect.top > viewport.height ||
    rect.right < 0 ||
    rect.left > viewport.width
  ) {
    hideMermaidToolbar({ keepViewer: mermaidViewerOpen.value });
    return;
  }
  const pos = clampToolbarPosition(
    {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    },
    measureMermaidToolbarSize(),
    viewport,
  );
  mermaidToolbarTop.value = pos.top;
  mermaidToolbarCenterX.value = pos.centerX;
  mermaidToolbarVisible.value = true;
}

function observeMermaidTarget(wrapper: HTMLElement) {
  disconnectMermaidTargetObserver();
  if (typeof MutationObserver === "undefined") {
    return;
  }
  mermaidTargetObserver = new MutationObserver(() => {
    if (!wrapper.isConnected) {
      hideMermaidToolbar();
    }
  });
  mermaidTargetObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function showMermaidToolbarFor(wrapper: HTMLElement) {
  const context = getMermaidDiagramContext(wrapper);
  if (!context) {
    return;
  }
  hideToolbar();
  mermaidTarget.value = wrapper;
  mermaidSourceSnapshot.value = context.source;
  mermaidSvgSnapshot.value = context.svg;
  mermaidDiagramIndex.value = diagramIndexAmongSuccess(wrapper);
  placeMermaidToolbar(wrapper);
  observeMermaidTarget(wrapper);
}

function onMermaidScrollOrResize() {
  if (!mermaidToolbarVisible.value || !mermaidTarget.value) {
    return;
  }
  if (!mermaidTarget.value.isConnected) {
    hideMermaidToolbar();
    return;
  }
  placeMermaidToolbar(mermaidTarget.value);
}

function onPreviewCaptureClick(event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (
    target.closest(
      '[data-testid="preview-mermaid-toolbar"], [data-testid="preview-format-toolbar"], [data-testid="mermaid-fullscreen-viewer"]',
    )
  ) {
    return;
  }

  if (isLocateModifier(event)) {
    // Cmd/Ctrl+click keeps the existing locate path; never arm the diagram toolbar.
    hideMermaidToolbar();
    return;
  }

  const resolved = resolveMermaidDiagramFromTarget(target);
  if (!resolved) {
    if (
      mermaidToolbarVisible.value &&
      !target.closest(".mermaid-diagram[data-mermaid='1']")
    ) {
      hideMermaidToolbar({ keepViewer: mermaidViewerOpen.value });
    }
    return;
  }

  // Capture-phase stop so editable readonly tip / other click handlers skip this hit.
  event.preventDefault();
  event.stopPropagation();
  showMermaidToolbarFor(resolved.wrapper);
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") {
    return;
  }
  if (mermaidViewerOpen.value) {
    return;
  }
  if (mermaidToolbarVisible.value) {
    event.preventDefault();
    hideMermaidToolbar();
  }
}

async function runMermaidPngExport(options?: {
  targetPath?: string;
  source?: string;
  diagramIndex?: number;
}): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  const source = (options?.source ?? mermaidSourceSnapshot.value).trim();
  if (!source) {
    return { ok: false, error: "未选中可导出的 Mermaid 图表" };
  }
  if (mermaidExportBusy.value) {
    return { ok: false, error: "正在导出 Mermaid PNG…" };
  }
  mermaidExportBusy.value = true;
  try {
    const { exportMermaidDiagramPng } = await import(
      "@/export/exportMermaidDiagramPng"
    );
    const result = await exportMermaidDiagramPng({
      source,
      fileName: props.fileName,
      diagramIndex: options?.diagramIndex ?? mermaidDiagramIndex.value,
      targetPath: options?.targetPath,
      onProgress: (message) => emit("status", message),
    });
    emit("status", `已导出：${result.fileName}`);
    return { ok: true, fileName: result.fileName };
  } catch (error) {
    if (
      error instanceof ExportCancelledError ||
      (error instanceof Error && error.name === "ExportCancelledError")
    ) {
      emit("status", "已取消导出");
      return { ok: false, error: "已取消导出" };
    }
    const message =
      error instanceof ExportFailedError || error instanceof Error
        ? error.message
        : String(error);
    emit("status", `导出失败：${message}`);
    try {
      const { showError } = await import("@/native/fileService");
      await showError("导出 Mermaid PNG 失败", error);
    } catch {
      // Status message remains the fallback when dialogs are unavailable.
    }
    return { ok: false, error: message };
  } finally {
    mermaidExportBusy.value = false;
  }
}

async function onMermaidExportPng() {
  await runMermaidPngExport();
}

function onMermaidFullscreen() {
  if (!mermaidSourceSnapshot.value || !mermaidSvgSnapshot.value) {
    return;
  }
  const active = document.activeElement;
  mermaidFullscreenBtn.value =
    active instanceof HTMLElement ? active : null;
  mermaidViewerOpen.value = true;
}

function onMermaidViewerClose() {
  mermaidViewerOpen.value = false;
  void nextTick(() => {
    mermaidFullscreenBtn.value?.focus?.();
  });
}

async function exportMermaidDiagramPngAt(
  diagramIndex: number,
  targetPath: string,
): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  const root = scrollRoot.value;
  if (!root) {
    return { ok: false, error: "预览未就绪" };
  }
  const wrappers = [
    ...root.querySelectorAll(
      ".mermaid-diagram[data-mermaid='1']:not([data-mermaid-error])",
    ),
  ] as HTMLElement[];
  const wrapper = wrappers[Math.max(0, diagramIndex - 1)];
  if (!wrapper) {
    return { ok: false, error: `未找到第 ${diagramIndex} 个 Mermaid 图表` };
  }
  const context = getMermaidDiagramContext(wrapper);
  if (!context) {
    return { ok: false, error: "图表上下文缺失" };
  }
  showMermaidToolbarFor(wrapper);
  return runMermaidPngExport({
    targetPath,
    source: context.source,
    diagramIndex,
  });
}

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
  const root = fallbackContainer.value;
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

function hideToolbar() {
  toolbarVisible.value = false;
  linkEditing.value = false;
  currentSelection.value = null;
  formatSelectionSnapshot.value = null;
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

function hideAllToolbars() {
  hideToolbar();
  hideMermaidToolbar();
}

function withExpectedText(
  resolved: PreviewFormatSelection,
): PreviewFormatSelection {
  if (resolved.expectedText != null || props.renderedSource == null) {
    return resolved;
  }
  if (
    resolved.from < 0 ||
    resolved.to > props.renderedSource.length ||
    resolved.to <= resolved.from
  ) {
    return resolved;
  }
  return {
    ...resolved,
    expectedText: props.renderedSource.slice(resolved.from, resolved.to),
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
  const snapshot = withExpectedText(resolved);
  currentSelection.value = snapshot;
  // Freeze once armed — toolbar clicks must consume this immutable snapshot.
  formatSelectionSnapshot.value = snapshot;
  toolbarActive.value = { ...snapshot.active };
  placeToolbar(snapshot.rect);
}

function onToolbarPointerDown() {
  suppressSelectionClear = true;
  // Editable mode keeps the frozen snapshot; never re-read on toolbar press.
  if (!useEditable.value && currentSelection.value) {
    formatSelectionSnapshot.value = withExpectedText(currentSelection.value);
  }
}

function onToolbarPointerUp() {
  window.requestAnimationFrame(() => {
    suppressSelectionClear = linkEditing.value;
  });
}

function onEditableSelectionChange(selection: PreviewFormatSelection | null) {
  // Editable mode is a one-way flow from the edit session. Do not refresh from
  // document selectionchange / toolbar pointerdown.
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
    // Editable snapshots are published solely by PreviewEditableHost.
    if (useEditable.value) {
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
  onMermaidScrollOrResize();
  if (!toolbarVisible.value || !currentSelection.value) {
    return;
  }
  if (useEditable.value) {
    // Keep the frozen snapshot; only re-place the toolbar from its rect.
    placeToolbar(currentSelection.value.rect);
    return;
  }
  const resolved = resolvePreviewSelection(fallbackContainer.value);
  if (!resolved) {
    hideToolbar();
    return;
  }
  currentSelection.value = withExpectedText(resolved);
  placeToolbar(currentSelection.value.rect);
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
  hideAllToolbars();
  emit("locate-source", line);
}

function onFallbackContextMenu(event: MouseEvent) {
  if (isLocateModifier(event)) {
    event.preventDefault();
  }
}

function emitFormat(action: PreviewFormatAction) {
  const selection =
    formatSelectionSnapshot.value ?? currentSelection.value;
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
  const expected =
    selection.expectedText ??
    props.renderedSource.slice(selection.from, selection.to);
  if (props.renderedSource.slice(selection.from, selection.to) !== expected) {
    // Stale snapshot — refuse and force a resync instead of formatting wrong text.
    hideToolbar();
    if (useEditable.value) {
      applyResolvedSelection(editableHost.value?.getFormatSelection() ?? null);
    } else {
      refreshFallbackToolbarFromSelection();
    }
    return;
  }
  suppressSelectionClear = true;
  emit("format-selection", {
    action,
    selection: { ...selection, expectedText: expected },
  });
  if (
    useEditable.value &&
    action.type === "toggle" &&
    action.format === "code"
  ) {
    // Inline code becomes a read-only atom after projection rebuild. Blur
    // before that rebuild so its fallback selection never paints as a caret.
    editableHost.value?.blur();
  }
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

async function waitForMermaidReady() {
  // Mermaid SVG height can shift after async mount. Wait for the current
  // cycle; if a newer cycle started while waiting, wait for that one too.
  for (let i = 0; i < 5; i += 1) {
    const waiting = mermaidReady;
    await waiting;
    if (mermaidReady === waiting) {
      break;
    }
  }
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
  await waitForMermaidReady();
  if (!fallbackContainer.value) {
    return;
  }
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
  hideAllToolbars();
  editableHost.value?.hideFormatToolbar();
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

function getFormatSelection(): PreviewFormatSelection | null {
  if (useEditable.value) {
    return (
      formatSelectionSnapshot.value ??
      editableHost.value?.getFormatSelection() ??
      null
    );
  }
  return formatSelectionSnapshot.value ?? currentSelection.value;
}

defineExpose({
  scrollToSourceLine,
  hideFormatToolbar,
  selectSourceRange,
  getFormatSelection,
  exportMermaidDiagramPngAt,
  hideMermaidToolbar,
});

watch(
  () => [props.html, props.editableSyncToken, props.renderMode] as const,
  () => {
    hideAllToolbars();
    if (useEditable.value) {
      flashId.value = null;
      clearFlashTimer();
      bumpMermaidGeneration();
      finishMermaidCycle();
      return;
    }
    void refreshMermaid();
  },
);

onMounted(() => {
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("resize", onScrollOrResize);
  window.addEventListener("keydown", onFormatKeyDown, true);
  window.addEventListener("keydown", onGlobalKeydown, true);
  scrollRoot.value?.addEventListener("scroll", onScrollOrResize, {
    passive: true,
  });
  scrollRoot.value?.addEventListener("click", onPreviewCaptureClick, true);
  if (!useEditable.value) {
    void refreshMermaid();
  }
});

onBeforeUnmount(() => {
  clearFlashTimer();
  bumpMermaidGeneration();
  finishMermaidCycle();
  hideAllToolbars();
  document.removeEventListener("selectionchange", onSelectionChange);
  window.removeEventListener("resize", onScrollOrResize);
  window.removeEventListener("keydown", onFormatKeyDown, true);
  window.removeEventListener("keydown", onGlobalKeydown, true);
  scrollRoot.value?.removeEventListener("scroll", onScrollOrResize);
  scrollRoot.value?.removeEventListener("click", onPreviewCaptureClick, true);
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
      @status="emit('edit-status', $event)"
      @selection-change="onEditableSelectionChange"
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
    <MermaidDiagramToolbar
      ref="mermaidToolbarRef"
      :visible="mermaidToolbarVisible"
      :top="mermaidToolbarTop"
      :center-x="mermaidToolbarCenterX"
      :busy="mermaidExportBusy"
      @fullscreen="onMermaidFullscreen"
      @export-png="onMermaidExportPng"
      @dismiss="hideMermaidToolbar()"
    />
    <MermaidFullscreenViewer
      :open="mermaidViewerOpen"
      :svg-html="mermaidSvgSnapshot"
      :export-busy="mermaidExportBusy"
      @close="onMermaidViewerClose"
      @export-png="onMermaidExportPng"
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
