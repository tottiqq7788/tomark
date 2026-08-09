import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import {
  registerPreviewImage,
  unregisterPreviewImage,
} from "@/preview/previewImageRegistry";
import { resolvePreviewImage } from "@/preview/resolvePreviewImage";

export type PreviewImageDocumentPathProvider = () => string | null;

let documentPathProvider: PreviewImageDocumentPathProvider = () => null;
const pathChangeListeners = new Set<() => void>();

/** Wire the active Markdown document path for local relative image resolution. */
export function setPreviewImageDocumentPathProvider(
  provider: PreviewImageDocumentPathProvider | null,
): void {
  documentPathProvider = provider ?? (() => null);
}

/** Ask mounted image NodeViews to re-resolve after documentPath changes. */
export function notifyPreviewImageDocumentPathChanged(): void {
  for (const listener of [...pathChangeListeners]) {
    listener();
  }
}

function showImageError(host: HTMLElement, message: string, alt: string): void {
  unregisterPreviewImage(host);
  host.replaceChildren();
  host.classList.add("preview-image-error");
  host.setAttribute("data-preview-image-error", "1");
  host.removeAttribute("data-preview-image");
  const label = document.createElement("span");
  label.className = "preview-image-error-label";
  label.title = message;
  label.textContent = alt ? `图片加载失败：${alt}` : "图片加载失败";
  host.appendChild(label);
}

/**
 * NodeView for `readonly_inline`. Image kinds mount a real <img> after resolve;
 * other kinds mirror the schema toDOM label.
 */
export function createReadonlyInlineNodeView(
  node: ProseMirrorNode,
  _view: EditorView,
  _getPos: () => number | undefined,
): NodeView {
  const kind = String(node.attrs.kind || "");
  if (kind !== "image") {
    const dom = document.createElement("span");
    const label = String(node.attrs.label || "");
    dom.className = `tm-readonly tm-readonly-inline tm-readonly-${kind}`;
    dom.setAttribute("contenteditable", "false");
    dom.setAttribute("data-tm-readonly", String(node.attrs.reason));
    dom.setAttribute("data-tm-from", String(node.attrs.sourceFrom));
    dom.setAttribute("data-tm-to", String(node.attrs.sourceTo));
    if (kind === "task-checkbox") {
      const checked = label === "☑";
      dom.setAttribute("role", "checkbox");
      dom.setAttribute("aria-checked", checked ? "true" : "false");
      dom.setAttribute("data-testid", "preview-task-checkbox");
      dom.title = checked ? "取消勾选" : "勾选";
    } else {
      dom.setAttribute("role", "note");
    }
    dom.textContent = label;
    return {
      dom,
      update(updated) {
        if (updated.type.name !== "readonly_inline") {
          return false;
        }
        if (String(updated.attrs.kind || "") === "image") {
          return false;
        }
        const nextKind = String(updated.attrs.kind || "unsupported");
        const nextLabel = String(updated.attrs.label || "");
        dom.setAttribute("data-tm-readonly", String(updated.attrs.reason));
        dom.setAttribute("data-tm-from", String(updated.attrs.sourceFrom));
        dom.setAttribute("data-tm-to", String(updated.attrs.sourceTo));
        dom.className = `tm-readonly tm-readonly-inline tm-readonly-${nextKind}`;
        if (nextKind === "task-checkbox") {
          const checked = nextLabel === "☑";
          dom.setAttribute("role", "checkbox");
          dom.setAttribute("aria-checked", checked ? "true" : "false");
          dom.setAttribute("data-testid", "preview-task-checkbox");
          dom.title = checked ? "取消勾选" : "勾选";
        } else {
          dom.setAttribute("role", "note");
          dom.removeAttribute("aria-checked");
          dom.removeAttribute("data-testid");
          dom.removeAttribute("title");
        }
        dom.textContent = nextLabel;
        return true;
      },
    };
  }

  const dom = document.createElement("span");
  dom.className =
    "tm-readonly tm-readonly-inline tm-readonly-image preview-image";
  dom.setAttribute("contenteditable", "false");
  dom.setAttribute("data-tm-readonly", String(node.attrs.reason));
  dom.setAttribute("data-tm-from", String(node.attrs.sourceFrom));
  dom.setAttribute("data-tm-to", String(node.attrs.sourceTo));
  dom.setAttribute("role", "img");

  let destroyed = false;
  let mountToken = 0;
  let src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  let alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  let title = typeof node.attrs.title === "string" ? node.attrs.title : "";

  const mount = () => {
    const token = ++mountToken;
    unregisterPreviewImage(dom);
    dom.classList.remove("preview-image-error");
    dom.removeAttribute("data-preview-image-error");
    dom.replaceChildren();
    if (!src.trim()) {
      showImageError(dom, "图片地址为空", alt);
      return;
    }
    const placeholder = document.createElement("span");
    placeholder.className = "preview-image-loading";
    placeholder.textContent = alt ? `图片：${alt}` : "图片";
    dom.appendChild(placeholder);

    void resolvePreviewImage(src, documentPathProvider())
      .then((resolved) => {
        if (destroyed || token !== mountToken) {
          return;
        }
        const img = document.createElement("img");
        img.src = resolved.dataUrl;
        if (alt) {
          img.alt = alt;
        }
        if (title) {
          img.title = title;
        }
        img.draggable = false;
        dom.replaceChildren(img);
        dom.setAttribute("data-preview-image", "1");
        dom.setAttribute("data-tm-image-src", src);
        registerPreviewImage(dom, {
          originalSrc: src,
          dataUrl: resolved.dataUrl,
          bytes: resolved.bytes,
          mimeType: resolved.mimeType,
          sourceLine: null,
        });
      })
      .catch((error) => {
        if (destroyed || token !== mountToken) {
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        showImageError(dom, message, alt);
      });
  };

  const onPathChange = () => {
    if (!destroyed) {
      mount();
    }
  };
  pathChangeListeners.add(onPathChange);
  mount();

  return {
    dom,
    selectNode() {
      dom.classList.add("ProseMirror-selectednode");
    },
    deselectNode() {
      dom.classList.remove("ProseMirror-selectednode");
    },
    update(updated) {
      if (updated.type.name !== "readonly_inline") {
        return false;
      }
      if (String(updated.attrs.kind || "") !== "image") {
        return false;
      }
      const nextSrc =
        typeof updated.attrs.src === "string" ? updated.attrs.src : "";
      const nextAlt =
        typeof updated.attrs.alt === "string" ? updated.attrs.alt : "";
      const nextTitle =
        typeof updated.attrs.title === "string" ? updated.attrs.title : "";
      dom.setAttribute("data-tm-readonly", String(updated.attrs.reason));
      dom.setAttribute("data-tm-from", String(updated.attrs.sourceFrom));
      dom.setAttribute("data-tm-to", String(updated.attrs.sourceTo));
      if (nextSrc !== src || nextAlt !== alt || nextTitle !== title) {
        src = nextSrc;
        alt = nextAlt;
        title = nextTitle;
        mount();
      }
      return true;
    },
    destroy() {
      destroyed = true;
      mountToken += 1;
      pathChangeListeners.delete(onPathChange);
      unregisterPreviewImage(dom);
    },
  };
}
