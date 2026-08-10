import { analyzeFlowchartEditability } from "@/preview/mermaidEditing/flowchartSourceModel";

export interface MermaidDiagramContext {
  /** Mermaid fence body (without ```mermaid fences). */
  source: string;
  /** SVG markup produced by Mermaid for this render. */
  svg: string;
  /** 1-based source line when available (fallback anchors / locate). */
  sourceLine: number | null;
  /** Full Markdown fence span including opening/closing markers. */
  fenceFrom: number | null;
  fenceTo: number | null;
  /** Exact fence body span (authoritative write-back target). */
  bodyFrom: number | null;
  bodyTo: number | null;
  /** True only when source is inside the lossless flowchart subset. */
  editable: boolean;
  editRejectReason: string | null;
}

export interface MermaidDiagramRegistration {
  source: string;
  svg: string;
  sourceLine?: number | null;
  fenceFrom?: number | null;
  fenceTo?: number | null;
  bodyFrom?: number | null;
  bodyTo?: number | null;
}

const registry = new WeakMap<HTMLElement, MermaidDiagramContext>();

function parseOptionalOffset(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function registerMermaidDiagram(
  wrapper: HTMLElement,
  context: MermaidDiagramRegistration,
): void {
  const capability = analyzeFlowchartEditability(context.source);
  registry.set(wrapper, {
    source: context.source,
    svg: context.svg,
    sourceLine: context.sourceLine ?? null,
    fenceFrom: parseOptionalOffset(context.fenceFrom),
    fenceTo: parseOptionalOffset(context.fenceTo),
    bodyFrom: parseOptionalOffset(context.bodyFrom),
    bodyTo: parseOptionalOffset(context.bodyTo),
    editable: capability.editable,
    editRejectReason: capability.reason,
  });
}

export function getMermaidDiagramContext(
  wrapper: HTMLElement | null | undefined,
): MermaidDiagramContext | null {
  if (!wrapper) {
    return null;
  }
  return registry.get(wrapper) ?? null;
}

/**
 * Resolve a successful Mermaid diagram from a click/event target.
 * Error blocks (`data-mermaid-error`) are ignored.
 */
export function resolveMermaidDiagramFromTarget(target: EventTarget | null): {
  wrapper: HTMLElement;
  svg: SVGSVGElement;
  context: MermaidDiagramContext;
} | null {
  if (!(target instanceof Node)) {
    return null;
  }
  const el =
    target.nodeType === Node.TEXT_NODE
      ? target.parentElement
      : target instanceof Element
        ? target
        : null;
  if (!el) {
    return null;
  }
  const wrapper = el.closest(
    ".mermaid-diagram[data-mermaid='1']",
  ) as HTMLElement | null;
  if (!wrapper || wrapper.hasAttribute("data-mermaid-error")) {
    return null;
  }
  const svg = wrapper.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    return null;
  }
  const context = registry.get(wrapper);
  if (!context) {
    return null;
  }
  return { wrapper, svg, context };
}

export function isMermaidDiagramElement(el: Element | null): boolean {
  return Boolean(
    el?.closest?.(".mermaid-diagram[data-mermaid='1']:not([data-mermaid-error])"),
  );
}

/** Test-only: inspect whether a wrapper is registered. */
export function __hasMermaidDiagramRegistrationForTests(
  wrapper: HTMLElement,
): boolean {
  return registry.has(wrapper);
}
