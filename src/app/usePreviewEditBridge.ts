import type { Ref } from "vue";
import type {
  ApplySourceTransactionResult,
  SourcePatchTransaction,
} from "@/shared/previewEditing";
import type {
  FormatRangeChange,
  PreviewFormatAction,
  PreviewFormatSelection,
} from "@/shared/previewFormatting";
import {
  toggleInlineFormat,
  toggleLink,
} from "@/editor/markdownInlineFormatting";
import type { PreviewEditStatus } from "@/preview/editing/usePreviewEditSession";
import {
  buildTaskCheckboxTogglePatch,
  type TaskCheckboxToggleRequest,
} from "@/preview/editing/taskCheckboxToggle";
import {
  buildMermaidVisualEditTransaction,
  type MermaidVisualEditCommitRequest,
} from "@/preview/mermaidEditing/mermaidEditCommit";

export type PreviewEditEditorApi = {
  applySourceTransaction: (
    transaction: SourcePatchTransaction,
  ) => ApplySourceTransactionResult;
  applyFormatChange?: (change: FormatRangeChange) => boolean;
  getRevision: () => number;
  getValue: () => string;
  getSelection?: () => { anchor: number; head: number };
  undo: () => boolean;
  redo: () => boolean;
};

export type PreviewEditBridgePreviewApi = {
  renderedSource: Ref<string | null>;
  isCurrent: () => boolean;
  syncNow: (options?: {
    selection?: { anchor: number; head: number } | null;
  }) => Promise<boolean>;
  syncAfterOwnEdit: (
    source: string,
    selection?: { anchor: number; head: number } | null,
    options?: { bumpSync?: boolean },
  ) => void;
  beginOwnEdit: () => void;
  endOwnEdit: () => void;
};

export type MermaidVisualEditCommitResult =
  | ApplySourceTransactionResult
  | {
      readonly ok: false;
      readonly reason: string;
      readonly message: string;
    };

/**
 * Connect preview format patches to CodeMirror's single undo history.
 */
export function usePreviewEditBridge(options: {
  getEditor: () => PreviewEditEditorApi | null;
  preview: PreviewEditBridgePreviewApi;
  statusMessage: Ref<string>;
}) {
  const { getEditor, preview, statusMessage } = options;

  function applySourceTransaction(
    transaction: SourcePatchTransaction,
  ): ApplySourceTransactionResult {
    const editor = getEditor();
    if (!editor) {
      return {
        ok: false,
        reason: "stale-revision",
        revision: 0,
      };
    }
    preview.beginOwnEdit();
    try {
      const result = editor.applySourceTransaction(transaction);
      if (!result.ok) {
        void preview.syncNow();
        statusMessage.value =
          result.reason === "stale-revision" ||
          result.reason === "expected-text-mismatch"
            ? "映射已过期，已重新同步"
            : "无法应用到源码，请改用源码区编辑";
        return result;
      }
      preview.syncAfterOwnEdit(result.value, transaction.selection ?? null, {
        // Format always needs a host rebuild to place the caret.
        bumpSync: true,
      });
      return result;
    } finally {
      preview.endOwnEdit();
    }
  }

  function getRevision(): number {
    return getEditor()?.getRevision() ?? 0;
  }

  function onEditStatus(status: PreviewEditStatus) {
    statusMessage.value = status.message;
    // Session stale statuses claim a resync — make that true by forcing one.
    if (status.kind === "stale") {
      void preview.syncNow();
    }
  }

  function onToggleTaskCheckbox(request: TaskCheckboxToggleRequest) {
    if (!preview.isCurrent()) {
      statusMessage.value = "预览内容已更新，请重试";
      return;
    }
    const source = preview.renderedSource.value;
    const editor = getEditor();
    if (source == null || !editor) {
      statusMessage.value = "编辑器尚未就绪";
      return;
    }
    if (editor.getValue() !== source) {
      statusMessage.value = "预览内容已更新，请重试";
      return;
    }
    if (request.revision !== editor.getRevision()) {
      statusMessage.value = "预览内容已更新，请重试";
      void preview.syncNow();
      return;
    }
    if (
      request.from < 0 ||
      request.to > source.length ||
      request.to <= request.from ||
      source.slice(request.from, request.to) !== request.expectedText
    ) {
      statusMessage.value = "任务状态已变化，请重试";
      void preview.syncNow();
      return;
    }

    const patch = buildTaskCheckboxTogglePatch(
      source,
      request.from,
      request.to,
    );
    if (!patch) {
      statusMessage.value = "无法切换该任务状态，请改用源码区";
      return;
    }

    const transaction: SourcePatchTransaction = {
      revision: editor.getRevision(),
      origin: "task-checkbox",
      patches: [patch],
    };
    // Failure status is already set by applySourceTransaction.
    applySourceTransaction(transaction);
  }

  async function onCommitMermaidVisual(
    request: MermaidVisualEditCommitRequest,
  ): Promise<MermaidVisualEditCommitResult> {
    if (!preview.isCurrent()) {
      const message = "预览内容已更新，请重新打开编辑器";
      statusMessage.value = message;
      return { ok: false, reason: "stale-preview", message };
    }
    const source = preview.renderedSource.value;
    const editor = getEditor();
    if (source == null || !editor) {
      const message = "编辑器尚未就绪";
      statusMessage.value = message;
      return { ok: false, reason: "editor-missing", message };
    }
    if (editor.getValue() !== source) {
      const message = "预览内容已更新，请重新打开编辑器";
      statusMessage.value = message;
      void preview.syncNow();
      return { ok: false, reason: "stale-preview", message };
    }

    const built = buildMermaidVisualEditTransaction(
      source,
      editor.getRevision(),
      request,
    );
    if (!built.ok) {
      statusMessage.value = built.message;
      if (
        built.reason === "stale-revision" ||
        built.reason === "expected-text-mismatch"
      ) {
        void preview.syncNow();
      }
      return built;
    }

    try {
      const { renderMermaidSvg } = await import("@/preview/renderMermaid");
      await renderMermaidSvg(request.nextText);
    } catch (error) {
      const message =
        error instanceof Error
          ? `草稿无法通过 Mermaid 严格渲染：${error.message}`
          : "草稿无法通过 Mermaid 严格渲染";
      statusMessage.value = message;
      return { ok: false, reason: "invalid-draft", message };
    }

    const result = applySourceTransaction(built.transaction);
    if (result.ok) {
      statusMessage.value = "已保存流程图更改";
    }
    return result;
  }

  async function onFormatSelection(payload: {
    action: PreviewFormatAction;
    selection: PreviewFormatSelection;
  }) {
    if (!preview.isCurrent()) {
      statusMessage.value = "预览内容已更新，请重新选择后再设置格式";
      return;
    }
    const source = preview.renderedSource.value;
    const editor = getEditor();
    if (source == null || !editor) {
      statusMessage.value = "编辑器尚未就绪";
      return;
    }
    const editorValue = editor.getValue();
    if (editorValue !== source) {
      statusMessage.value = "预览内容已更新，请重新选择后再设置格式";
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
    if (
      selection.expectedText != null &&
      source.slice(selection.from, selection.to) !== selection.expectedText
    ) {
      statusMessage.value = "预览选区已变化，请重新选择后再设置格式";
      return;
    }
    if (
      selection.revision != null &&
      selection.revision !== editor.getRevision()
    ) {
      statusMessage.value = "预览内容已更新，请重新选择后再设置格式";
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

    const transaction: SourcePatchTransaction = {
      revision: editor.getRevision(),
      origin: "format",
      patches: [
        {
          from: change.from,
          to: change.to,
          insert: change.insert,
          expectedText: source.slice(change.from, change.to),
        },
      ],
      selection: {
        anchor: change.selectionFrom ?? change.from,
        head:
          change.selectionTo ?? change.from + change.insert.length,
      },
    };

    const result = applySourceTransaction(transaction);
    if (!result.ok) {
      statusMessage.value = "应用格式失败";
    }
  }

  function undoEdit(): boolean {
    const editor = getEditor();
    if (!editor) {
      return false;
    }
    const ran = editor.undo();
    if (ran) {
      void preview.syncNow({
        selection: editor.getSelection?.() ?? null,
      });
    }
    return ran;
  }

  function redoEdit(): boolean {
    const editor = getEditor();
    if (!editor) {
      return false;
    }
    const ran = editor.redo();
    if (ran) {
      void preview.syncNow({
        selection: editor.getSelection?.() ?? null,
      });
    }
    return ran;
  }

  return {
    getRevision,
    onEditStatus,
    onFormatSelection,
    onToggleTaskCheckbox,
    onCommitMermaidVisual,
    undoEdit,
    redoEdit,
  };
}
