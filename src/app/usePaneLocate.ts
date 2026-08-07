import { nextTick, ref, watch, type Ref } from "vue";
import type { FormatRangeChange } from "@/editor/createEditor";
import type {
  PreviewFormatAction,
  PreviewFormatSelection,
} from "@/shared/previewFormatting";
import {
  toggleInlineFormat,
  toggleLink,
} from "@/editor/markdownInlineFormatting";

export type EditorPaneExpose = {
  revealSourceLine: (line: number) => void;
  requestMeasure?: () => void;
  applyFormatChange?: (change: FormatRangeChange) => boolean;
  getValue?: () => string;
};

export type PreviewLocateApi = {
  attachPreview: (
    el: { scrollToSourceLine: (line: number) => Promise<void> } | null,
  ) => void;
  syncNow: () => Promise<boolean>;
  locate: (line: number) => void;
  isCurrent: () => boolean;
  renderedSource: Ref<string | null>;
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
}) {
  const { preview, isSourceVisible, isPreviewVisible, viewMode, statusMessage } =
    options;

  const editorPaneRef = ref<EditorPaneExpose | null>(null);
  let pendingRevealLine: number | null = null;

  function setPreviewRef(el: unknown) {
    preview.attachPreview(
      (el as { scrollToSourceLine?: (line: number) => Promise<void> } | null) &&
        typeof (el as { scrollToSourceLine?: unknown }).scrollToSourceLine ===
          "function"
        ? (el as { scrollToSourceLine: (line: number) => Promise<void> })
        : null,
    );
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

  async function onFormatSelection(payload: {
    action: PreviewFormatAction;
    selection: PreviewFormatSelection;
  }) {
    if (!preview.isCurrent()) {
      statusMessage.value = "预览内容已更新，请重新选择后再设置格式";
      return;
    }
    const source =
      preview.renderedSource.value ??
      editorPaneRef.value?.getValue?.() ??
      null;
    if (source == null) {
      return;
    }
    const { action, selection } = payload;
    if (
      selection.from < 0 ||
      selection.to > source.length ||
      selection.to <= selection.from
    ) {
      return;
    }

    let change: FormatRangeChange | null = null;
    if (action.type === "toggle") {
      const outer = selection.active.ranges[action.format];
      change = toggleInlineFormat(
        source,
        selection.from,
        selection.to,
        action.format,
        {
          active: selection.active[action.format],
          outerFrom: outer?.from,
          outerTo: outer?.to,
        },
      );
    } else {
      const outer = selection.active.ranges.link;
      change = toggleLink(source, selection.from, selection.to, {
        active: selection.active.link && action.href == null,
        href: action.href,
        outerFrom: outer?.from,
        outerTo: outer?.to,
      });
    }

    if (!change) {
      statusMessage.value = "无法应用该格式，请调整选区后重试";
      return;
    }

    const applied = editorPaneRef.value?.applyFormatChange?.(change) ?? false;
    if (!applied) {
      statusMessage.value = "应用格式失败";
      return;
    }
    await preview.syncNow();
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
    scheduleEditorMeasure();
  });

  return {
    editorPaneRef,
    setPreviewRef,
    setEditorPaneRef,
    onLocateSource,
    onLocatePreview,
    onFormatSelection,
    scheduleEditorMeasure,
  };
}
