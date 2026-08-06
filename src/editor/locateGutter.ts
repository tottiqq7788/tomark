import { EditorView, gutter, GutterMarker, type BlockInfo } from "@codemirror/view";

export type LocateHandler = (sourceLine: number) => void;

class LocateMarker extends GutterMarker {
  constructor(readonly line: number) {
    super();
  }

  eq(other: LocateMarker) {
    return this.line === other.line;
  }

  toDOM() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-locate-marker";
    btn.textContent = "◎";
    btn.title = `定位到预览（第 ${this.line} 行）`;
    btn.setAttribute("aria-label", btn.title);
    btn.dataset.line = String(this.line);
    return btn;
  }
}

function lineNumberAt(view: EditorView, block: BlockInfo): number {
  return view.state.doc.lineAt(block.from).number;
}

export function locateGutter(onLocate: LocateHandler) {
  return [
    gutter({
      class: "cm-locate-gutter",
      lineMarker: (view, block) => {
        const line = lineNumberAt(view, block);
        return new LocateMarker(line);
      },
      domEventHandlers: {
        click: (view, block, event) => {
          event.preventDefault();
          onLocate(lineNumberAt(view, block));
          view.focus();
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-locate-gutter": {
        width: "18px",
      },
      ".cm-locate-marker": {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: "#6b7280",
        fontSize: "11px",
        padding: "0",
        lineHeight: "1",
      },
      ".cm-locate-marker:hover": {
        color: "#2563eb",
      },
    }),
  ];
}
