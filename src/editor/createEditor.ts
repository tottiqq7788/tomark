import {
  EditorSelection,
  EditorState,
  Compartment,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
  redo as cmRedo,
  undo as cmUndo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import {
  applyDefaultHeadingFoldsEffect,
  headingFoldExtensions,
  revealSourceLineEffect,
} from "./headingFoldExtension";
import { isLocateModifier } from "@/shared/locateModifier";
import type { FormatRangeChange } from "@/shared/previewFormatting";
import {
  validateSourcePatchTransaction,
  type ApplySourceTransactionResult,
  type PreviewEditOrigin,
  type SourcePatchTransaction,
} from "@/shared/previewEditing";

export type { FormatRangeChange };
export type {
  ApplySourceTransactionResult,
  SourcePatchTransaction,
} from "@/shared/previewEditing";

export type LocateHandler = (sourceLine: number) => void;

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (value: string) => void;
  onLocate: LocateHandler;
  extensions?: Extension[];
}

export interface EditorHandle {
  view: EditorView;
  setDocument: (doc: string, options?: { collapseHeadings?: boolean }) => void;
  revealSourceLine: (line: number) => void;
  /** Apply a local Markdown edit as one undoable transaction. */
  applyFormatChange: (change: FormatRangeChange) => boolean;
  /** Apply guarded, non-overlapping source patches in one CodeMirror dispatch. */
  applySourceTransaction: (
    transaction: SourcePatchTransaction,
  ) => ApplySourceTransactionResult;
  getRevision: () => number;
  undo: () => boolean;
  redo: () => boolean;
  /** Re-measure geometry after the editor pane was hidden or resized. */
  requestMeasure: () => void;
  getValue: () => string;
  getSelection: () => { anchor: number; head: number };
  destroy: () => void;
}

const flashLineEffect = StateEffect.define<number | null>();

function mapFlashLine(tr: Transaction, line: number | null): number | null {
  if (line === null || !tr.docChanged) {
    return line;
  }
  try {
    if (line < 1 || line > tr.startState.doc.lines) {
      return null;
    }
    const oldPos = tr.startState.doc.line(line).from;
    const newPos = tr.changes.mapPos(oldPos, 1);
    if (newPos < 0 || newPos > tr.state.doc.length) {
      return null;
    }
    return tr.state.doc.lineAt(newPos).number;
  } catch {
    return null;
  }
}

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const readOnly = new Compartment();
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      revision += 1;
      options.onChange(update.state.doc.toString());
    }
  });

  const locateClick = EditorView.domEventHandlers({
    click(event, view) {
      if (!isLocateModifier(event)) {
        return false;
      }
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) {
        return false;
      }
      event.preventDefault();
      const line = view.state.doc.lineAt(pos).number;
      options.onLocate(line);
      return true;
    },
    contextmenu(event) {
      // Defensive: if a platform still fires locate-like chord with menu, suppress menu.
      if (isLocateModifier(event)) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  });

  const flashField = StateField.define<{
    line: number | null;
    deco: ReturnType<typeof Decoration.set>;
  }>({
    create: () => ({ line: null, deco: Decoration.none }),
    update(value, tr) {
      let line = mapFlashLine(tr, value.line);
      for (const effect of tr.effects) {
        if (effect.is(flashLineEffect)) {
          line = effect.value;
        }
      }
      if (line === null || line < 1 || line > tr.state.doc.lines) {
        return { line: null, deco: Decoration.none };
      }
      const lineObj = tr.state.doc.line(line);
      return {
        line,
        deco: Decoration.set([
          Decoration.line({ class: "cm-locate-flash" }).range(lineObj.from),
        ]),
      };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  const theme = EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "14px",
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      lineHeight: "1.55",
    },
    ".cm-content": {
      padding: "12px 0",
    },
    ".cm-heading-fold-gutter": {
      width: "16px",
    },
    ".cm-heading-fold-marker": {
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: "#4b5563",
      fontSize: "12px",
      padding: "0 2px",
      lineHeight: "1",
    },
    ".cm-heading-fold-marker:hover": {
      color: "#111827",
    },
    ".cm-gutters": {
      backgroundColor: "#f8fafc",
      borderRight: "1px solid #e5e7eb",
      color: "#9ca3af",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#eef2ff",
    },
    ".cm-locate-flash": {
      backgroundColor: "#dbeafe",
    },
  });

  const startState = EditorState.create({
    doc: options.doc,
    extensions: [
      lineNumbers(),
      ...headingFoldExtensions(),
      drawSelection(),
      highlightActiveLine(),
      history(),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      locateClick,
      flashField,
      updateListener,
      theme,
      readOnly.of([]),
      ...(options.extensions ?? []),
    ],
  });

  const view = new EditorView({
    state: startState,
    parent: options.parent,
  });

  function clearFlashSoon() {
    if (flashTimer) {
      clearTimeout(flashTimer);
    }
    flashTimer = setTimeout(() => {
      flashTimer = null;
      view.dispatch({ effects: flashLineEffect.of(null) });
    }, 1200);
  }

  function sourceUserEvent(origin: PreviewEditOrigin): string {
    switch (origin) {
      case "typing":
        return "input.type.preview";
      case "composition":
        return "input.type.compose.preview";
      case "paste":
        return "input.paste.preview";
      case "format":
        return "input.preview.format";
      case "structure":
        return "input.preview.structure";
    }
  }

  function applySourceTransaction(
    transaction: SourcePatchTransaction,
  ): ApplySourceTransactionResult {
    const source = view.state.doc.toString();
    const validation = validateSourcePatchTransaction(
      source,
      revision,
      transaction,
    );
    if (!validation.ok) {
      return validation;
    }

    const annotations = [
      Transaction.userEvent.of(sourceUserEvent(transaction.origin)),
    ];
    // Continuous adjacent typing may coalesce. Every composition, paste,
    // formatting action, and structure command is an explicit undo boundary.
    if (transaction.origin !== "typing") {
      annotations.push(isolateHistory.of("full"));
    }
    view.dispatch({
      changes: validation.patches.map((patch) => ({
        from: patch.from,
        to: patch.to,
        insert: patch.insert,
      })),
      ...(validation.selection
        ? {
            selection: EditorSelection.single(
              validation.selection.anchor,
              validation.selection.head,
            ),
          }
        : {}),
      annotations,
    });
    return {
      ok: true,
      revision,
      value: view.state.doc.toString(),
    };
  }

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setDocument: (doc, opts) => {
      const effects =
        opts?.collapseHeadings === false ? [] : [applyDefaultHeadingFoldsEffect()];
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: doc,
        },
        effects,
        annotations: Transaction.addToHistory.of(false),
      });
    },
    applySourceTransaction,
    getRevision: () => revision,
    applyFormatChange: (change) =>
      applySourceTransaction({
        revision,
        origin: "format",
        patches: [
          {
            from: change.from,
            to: change.to,
            insert: change.insert,
            expectedText:
              change.expectedText ??
              view.state.doc.sliceString(change.from, change.to),
          },
        ],
        selection: {
          anchor: change.selectionFrom ?? change.from,
          head: change.selectionTo ?? change.from + change.insert.length,
        },
      }).ok,
    undo: () => cmUndo(view),
    redo: () => cmRedo(view),
    revealSourceLine: (line) => {
      if (line < 1 || line > view.state.doc.lines) {
        return;
      }
      const lineObj = view.state.doc.line(line);
      view.dispatch({
        effects: [
          revealSourceLineEffect.of(line),
          flashLineEffect.of(line),
          EditorView.scrollIntoView(lineObj.from, { y: "start", yMargin: 24 }),
        ],
      });
      clearFlashSoon();
      view.focus();
    },
    requestMeasure: () => {
      view.requestMeasure();
    },
    getSelection: () => ({
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
    }),
    destroy: () => {
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = null;
      }
      view.destroy();
    },
  };
}
