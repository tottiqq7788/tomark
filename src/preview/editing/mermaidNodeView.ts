import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";

type MermaidRendererLoader = () => Promise<
  Pick<
    typeof import("@/preview/renderMermaid"),
    "renderMermaidInto"
  >
>;

const defaultMermaidRendererLoader: MermaidRendererLoader = () =>
  import("@/preview/renderMermaid");
let mermaidRendererLoader = defaultMermaidRendererLoader;

let pendingRenders = 0;
let readyWaiters: Array<() => void> = [];

function notifyReadyIfIdle() {
  if (pendingRenders > 0) {
    return;
  }
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const resolve of waiters) {
    resolve();
  }
}

function beginPending() {
  pendingRenders += 1;
}

function finishPending() {
  pendingRenders = Math.max(0, pendingRenders - 1);
  notifyReadyIfIdle();
}

/**
 * Resolve when every in-flight editable Mermaid NodeView has finished (or been
 * cancelled). Locate/scroll should await this so SVG height is stable.
 */
export function waitForEditableMermaidReady(): Promise<void> {
  if (pendingRenders === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    readyWaiters.push(resolve);
  });
}

export function isEditableMermaidPending(): boolean {
  return pendingRenders > 0;
}

/** Test-only. */
export function __resetEditableMermaidPendingForTests() {
  pendingRenders = 0;
  readyWaiters = [];
}

/** Test-only: swap the editable renderer chunk loader. */
export function __setEditableMermaidRendererLoaderForTests(
  loader: MermaidRendererLoader | null,
) {
  mermaidRendererLoader = loader ?? defaultMermaidRendererLoader;
}

function createReadonlyShell(node: ProseMirrorNode): HTMLElement {
  const dom = document.createElement("div");
  const kind = String(node.attrs.kind || "unsupported");
  dom.className = `tm-readonly tm-readonly-block tm-readonly-${kind}`;
  dom.setAttribute("contenteditable", "false");
  dom.setAttribute("data-tm-readonly", String(node.attrs.reason));
  dom.setAttribute("data-tm-from", String(node.attrs.sourceFrom));
  dom.setAttribute("data-tm-to", String(node.attrs.sourceTo));
  dom.setAttribute("role", "note");
  return dom;
}

function showMermaidLoadError(
  host: HTMLElement,
  source: string,
  error: unknown,
) {
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-diagram mermaid-error";
  wrapper.setAttribute("data-mermaid-error", "1");

  const title = document.createElement("div");
  title.className = "mermaid-error-title";
  title.textContent = "Mermaid 渲染失败";

  const detail = document.createElement("div");
  detail.className = "mermaid-error-detail";
  const message = error instanceof Error ? error.message : String(error);
  detail.textContent = `无法加载 Mermaid：${message}`;

  const fallback = document.createElement("pre");
  fallback.className = "mermaid-error-source";
  const code = document.createElement("code");
  code.textContent = source;
  fallback.appendChild(code);

  wrapper.append(title, detail, fallback);
  host.replaceChildren(wrapper);
}

/**
 * NodeView for `readonly_block`. Mermaid kinds get async SVG mounting; other
 * kinds mirror the schema toDOM label atom.
 */
export function createReadonlyBlockNodeView(
  node: ProseMirrorNode,
  _view: EditorView,
  _getPos: () => number | undefined,
): NodeView {
  const dom = createReadonlyShell(node);
  let destroyed = false;
  let mountToken = 0;
  let code = String(node.attrs.code || "");
  let kind = String(node.attrs.kind || "");

  const showLabel = () => {
    dom.replaceChildren(document.createTextNode(String(node.attrs.label || "")));
  };

  const mountMermaid = () => {
    // Invalidate any prior async render even when the updated node is no longer
    // Mermaid. Otherwise a late SVG can overwrite the new readonly label.
    const token = ++mountToken;
    if (kind !== "mermaid") {
      showLabel();
      return;
    }
    beginPending();
    // Placeholder until the async chunk finishes — keeps layout/locate stable.
    showLabel();
    void mermaidRendererLoader()
      .then(({ renderMermaidInto }) => {
        if (destroyed || token !== mountToken) {
          return;
        }
        return renderMermaidInto(dom, code, {
          renderId: `tomark-pm-mermaid-${token}-${Math.random().toString(36).slice(2, 6)}`,
          isCancelled: () => destroyed || token !== mountToken,
        });
      })
      .catch((error) => {
        if (!destroyed && token === mountToken) {
          showMermaidLoadError(dom, code, error);
        }
      })
      .finally(() => {
        finishPending();
      });
  };

  mountMermaid();

  return {
    dom,
    selectNode() {
      dom.classList.add("ProseMirror-selectednode");
    },
    deselectNode() {
      dom.classList.remove("ProseMirror-selectednode");
    },
    update(updated) {
      if (updated.type.name !== "readonly_block") {
        return false;
      }
      const nextKind = String(updated.attrs.kind || "");
      const nextCode = String(updated.attrs.code || "");
      const nextLabel = String(updated.attrs.label || "");
      dom.setAttribute("data-tm-readonly", String(updated.attrs.reason));
      dom.setAttribute("data-tm-from", String(updated.attrs.sourceFrom));
      dom.setAttribute("data-tm-to", String(updated.attrs.sourceTo));
      const classKind = nextKind || "unsupported";
      dom.className = `tm-readonly tm-readonly-block tm-readonly-${classKind}`;
      if (nextKind !== kind || nextCode !== code) {
        kind = nextKind;
        code = nextCode;
        node = updated;
        mountMermaid();
        return true;
      }
      if (nextKind !== "mermaid" && nextLabel !== String(node.attrs.label || "")) {
        node = updated;
        showLabel();
      } else {
        node = updated;
      }
      return true;
    },
    stopEvent() {
      // Mermaid SVG / error UI is decorative; keep PM selection model in charge.
      return false;
    },
    ignoreMutation() {
      // Async SVG / error DOM must not be treated as PM document edits.
      return true;
    },
    destroy() {
      destroyed = true;
      mountToken += 1;
    },
  };
}
