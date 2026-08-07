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
  setComposing: (composing: boolean) => void;
  flushEditSession: () => Promise<void>;
  flushCompositionOnly?: () => void;
};

/**
 * Connect editable-preview patches to CodeMirror's single undo history.
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
        // Structure/format need a host rebuild to place the caret. Typing and
        // composition already updated the PM session optimistically.
        bumpSync:
          transaction.origin === "structure" ||
          transaction.origin === "format",
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

  function onComposingChange(composing: boolean) {
    preview.setComposing(composing);
    if (composing) {
      statusMessage.value = "正在预览中编辑";
    }
  }

  async function onFormatSelection(payload: {
    action: PreviewFormatAction;
    selection: PreviewFormatSelection;
  }) {
    preview.flushCompositionOnly?.();
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

  async function flushBeforeAction(): Promise<void> {
    await preview.flushEditSession();
  }

  /** Prefer for keyboard shortcuts so handlers stay same-tick when idle. */
  function flushCompositionBeforeAction(): void {
    preview.flushCompositionOnly?.();
  }

  function undoEdit(): boolean {
    preview.flushCompositionOnly?.();
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
    preview.flushCompositionOnly?.();
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
    applySourceTransaction,
    getRevision,
    onEditStatus,
    onComposingChange,
    onFormatSelection,
    flushBeforeAction,
    flushCompositionBeforeAction,
    undoEdit,
    redoEdit,
  };
}
