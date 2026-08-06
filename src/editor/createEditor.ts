import {
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import {
  applyDefaultHeadingFoldsEffect,
  headingFoldExtensions,
  revealSourceLineEffect,
} from "./headingFoldExtension";
import { isLocateModifier } from "@/shared/locateModifier";

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
  /** Re-measure geometry after the editor pane was hidden or resized. */
  requestMeasure: () => void;
  getValue: () => string;
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

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
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
    destroy: () => {
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = null;
      }
      view.destroy();
    },
  };
}
