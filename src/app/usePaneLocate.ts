import { nextTick, ref, watch, type Ref } from "vue";
import type {
  ApplySourceTransactionResult,
  SourcePatchTransaction,
} from "@/shared/previewEditing";
import type { FormatRangeChange } from "@/shared/previewFormatting";

export type EditorPaneExpose = {
  revealSourceLine: (line: number) => void;
  requestMeasure?: () => void;
  applyFormatChange?: (change: FormatRangeChange) => boolean;
  applySourceTransaction?: (
    transaction: SourcePatchTransaction,
  ) => ApplySourceTransactionResult;
  getRevision?: () => number;
  getValue?: () => string;
  getSelection?: () => { anchor: number; head: number };
  undo?: () => boolean;
  redo?: () => boolean;
};

export type PreviewLocateApi = {
  attachPreview: (
    el: {
      scrollToSourceLine: (line: number) => Promise<void>;
      flushComposition?: () => void;
      isComposing?: () => boolean;
    } | null,
  ) => void;
  syncNow: () => Promise<boolean>;
  locate: (line: number) => void;
  isCurrent: () => boolean;
  renderedSource: Ref<string | null>;
  flushEditSession?: () => Promise<void>;
};

/**
 * Source ↔ preview Cmd/Ctrl-click locate, plus editor measure after view changes.
 */
export function usePaneLocate(options: {
  preview: PreviewLocateApi;
  isSourceVisible: Ref<boolean>;
  isPreviewVisible: Ref<boolean>;
  viewMode: Ref<unknown>;
  statusMessage: Ref<string>;
  /** Optional: flush preview composition before locate / view switches. */
  flushPreviewEdit?: () => Promise<void>;
}) {
  const {
    preview,
    isSourceVisible,
    isPreviewVisible,
    viewMode,
    statusMessage,
    flushPreviewEdit,
  } = options;

  const editorPaneRef = ref<EditorPaneExpose | null>(null);
  let pendingRevealLine: number | null = null;

  function setPreviewRef(el: unknown) {
    const candidate = el as {
      scrollToSourceLine?: (line: number) => Promise<void>;
      flushComposition?: () => void;
      isComposing?: () => boolean;
    } | null;
    if (candidate && typeof candidate.scrollToSourceLine === "function") {
      preview.attachPreview({
        scrollToSourceLine: candidate.scrollToSourceLine,
        flushComposition: candidate.flushComposition,
        isComposing: candidate.isComposing,
      });
      return;
    }
    preview.attachPreview(null);
  }

  function setEditorPaneRef(el: unknown) {
    const pane =
      el &&
      typeof (el as { revealSourceLine?: unknown }).revealSourceLine ===
        "function"
        ? (el as EditorPaneExpose)
        : null;
    editorPaneRef.value = pane;
    if (pane && pendingRevealLine !== null) {
      const line = pendingRevealLine;
      pendingRevealLine = null;
      pane.revealSourceLine(line);
    }
  }

  async function onLocateSource(line: number) {
    await flushPreviewEdit?.();
    await preview.flushEditSession?.();
    if (!isSourceVisible.value) {
      statusMessage.value = "当前为渲染视图，请切换到源码或双栏后再定位";
      return;
    }
    pendingRevealLine = null;
    const wasCurrent = preview.isCurrent();
    const synced = await preview.syncNow();
    if (!synced) {
      return;
    }
    if (!wasCurrent || !preview.isCurrent()) {
      statusMessage.value = "预览内容已更新，请重新点击定位";
      return;
    }
    if (editorPaneRef.value) {
      editorPaneRef.value.revealSourceLine(line);
    } else {
      pendingRevealLine = line;
    }
  }

  function onLocatePreview(line: number) {
    if (!isPreviewVisible.value) {
      statusMessage.value = "当前为源码视图，请切换到渲染或双栏后再定位";
      return;
    }
    void preview.locate(line);
  }

  function scheduleEditorMeasure() {
    if (!isSourceVisible.value) {
      return;
    }
    void nextTick(() => {
      requestAnimationFrame(() => {
        editorPaneRef.value?.requestMeasure?.();
      });
    });
  }

  watch(viewMode, () => {
    void flushPreviewEdit?.();
    scheduleEditorMeasure();
  });

  function undoEdit(): boolean {
    return editorPaneRef.value?.undo?.() ?? false;
  }

  function redoEdit(): boolean {
    return editorPaneRef.value?.redo?.() ?? false;
  }

  return {
    editorPaneRef,
    setPreviewRef,
    setEditorPaneRef,
    onLocateSource,
    onLocatePreview,
    undoEdit,
    redoEdit,
    scheduleEditorMeasure,
  };
}
