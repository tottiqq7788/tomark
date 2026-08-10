import type MermaidApi from "mermaid";
import {
  adoptMermaidGeneration,
  bumpMermaidGeneration,
  currentMermaidGeneration,
  __resetMermaidGenerationForTests,
} from "@/preview/mermaidGeneration";
import { registerMermaidDiagram } from "@/preview/mermaidDiagramRegistry";

export type MermaidModule = typeof MermaidApi;

type MermaidLoader = () => Promise<{ default: MermaidModule }>;

const MERMAID_CODE_SELECTOR = "pre > code.language-mermaid";

let mermaidPromise: Promise<MermaidModule> | null = null;
let mermaidLoader: MermaidLoader = () =>
  import("@/preview/loadMermaid").then((m) => m.loadMermaid());

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Test-only: swap the dynamic import used to load mermaid. */
export function __setMermaidLoaderForTests(loader: MermaidLoader | null) {
  mermaidLoader =
    loader ??
    (() => import("@/preview/loadMermaid").then((m) => m.loadMermaid()));
  mermaidPromise = null;
}

/** Test-only: reset cached mermaid instance and render generation. */
export function __resetMermaidStateForTests() {
  mermaidPromise = null;
  __resetMermaidGenerationForTests();
}

function isMermaidLanguage(className: string | null): boolean {
  if (!className) {
    return false;
  }
  return className
    .split(/\s+/)
    .some((token) => token.toLowerCase() === "language-mermaid");
}

function collectMermaidBlocks(root: ParentNode): Array<{
  pre: HTMLPreElement;
  code: HTMLElement;
  source: string;
}> {
  const nodes = root.querySelectorAll(MERMAID_CODE_SELECTOR);
  const blocks: Array<{ pre: HTMLPreElement; code: HTMLElement; source: string }> =
    [];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (!isMermaidLanguage(node.getAttribute("class"))) {
      continue;
    }
    const pre = node.parentElement;
    if (!(pre instanceof HTMLPreElement)) {
      continue;
    }
    blocks.push({ pre, code: node, source: node.textContent ?? "" });
  }
  return blocks;
}

async function getMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = mermaidLoader()
      .then((mod) => {
        const api = mod.default;
        api.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Use Mermaid's default multi-color palette (neutral was nearly monochrome).
          theme: "default",
          fontFamily: FONT_FAMILY,
          themeVariables: {
            fontFamily: FONT_FAMILY,
            primaryTextColor: "#1f2937",
            lineColor: "#64748b",
            // Keep pie / sequence / class secondary fills distinct instead of flat grey.
            secondaryColor: "#e0f2fe",
            tertiaryColor: "#fef3c7",
          },
        });
        return api;
      })
      .catch((error) => {
        // Chunk loads can fail transiently. Do not poison the whole session
        // with a permanently rejected cached promise.
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

function copyAnchorAttrs(from: HTMLElement, to: HTMLElement) {
  for (const name of [
    "data-source-line",
    "data-source-end",
    "data-anchor-id",
    "data-tm-from",
    "data-tm-to",
    "data-tm-body-from",
    "data-tm-body-to",
  ] as const) {
    const value = from.getAttribute(name);
    if (value !== null) {
      to.setAttribute(name, value);
    }
  }
}

function parseOptionalInt(raw: string | null): number | null {
  if (raw == null || raw === "") {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function resolveBodyRangeFromHost(
  host: HTMLElement,
  source: string,
): { fenceFrom: number | null; fenceTo: number | null; bodyFrom: number | null; bodyTo: number | null } {
  const bodyFromAttr = parseOptionalInt(host.getAttribute("data-tm-body-from"));
  const bodyToAttr = parseOptionalInt(host.getAttribute("data-tm-body-to"));
  if (
    bodyFromAttr != null &&
    bodyToAttr != null &&
    bodyToAttr >= bodyFromAttr
  ) {
    const fenceFrom = parseOptionalInt(host.getAttribute("data-tm-from"));
    const fenceTo = parseOptionalInt(host.getAttribute("data-tm-to"));
    return {
      fenceFrom,
      fenceTo,
      bodyFrom: bodyFromAttr,
      bodyTo: bodyToAttr,
    };
  }
  const fenceFrom = parseOptionalInt(host.getAttribute("data-tm-from"));
  const fenceTo = parseOptionalInt(host.getAttribute("data-tm-to"));
  if (fenceFrom == null || fenceTo == null || fenceTo < fenceFrom) {
    return {
      fenceFrom: null,
      fenceTo: null,
      bodyFrom: null,
      bodyTo: null,
    };
  }
  // Host may be the pre or a readonly shell that already carries fence offsets.
  // Reconstruct body offsets from the opening fence line length when possible.
  // Without the full Markdown document we cannot verify; leave body null and
  // let PreviewPane resolve via renderedSource + fence attrs at edit time.
  void source;
  return {
    fenceFrom,
    fenceTo,
    bodyFrom: null,
    bodyTo: null,
  };
}

function buildErrorContent(source: string, message: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-diagram mermaid-error";
  wrapper.setAttribute("data-mermaid-error", "1");

  const title = document.createElement("div");
  title.className = "mermaid-error-title";
  title.textContent = "Mermaid 渲染失败";

  const detail = document.createElement("div");
  detail.className = "mermaid-error-detail";
  detail.textContent = message;

  const fallback = document.createElement("pre");
  fallback.className = "mermaid-error-source";
  const code = document.createElement("code");
  code.textContent = source;
  fallback.appendChild(code);

  wrapper.append(title, detail, fallback);
  return wrapper;
}

function parseSourceLine(raw: string | null): number | null {
  if (raw == null || raw === "") {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function buildSuccessContent(
  svg: string,
  source: string,
  options?: {
    sourceLine?: number | null;
    fenceFrom?: number | null;
    fenceTo?: number | null;
    bodyFrom?: number | null;
    bodyTo?: number | null;
  },
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-diagram";
  wrapper.setAttribute("data-mermaid", "1");
  // Mermaid SVG is generated by the library under securityLevel:strict.
  // Mermaid also lists securityLevel in its secure config keys, so diagram
  // frontmatter cannot loosen sanitization for this insert.
  wrapper.innerHTML = svg;
  registerMermaidDiagram(wrapper, {
    source,
    svg,
    sourceLine: options?.sourceLine ?? null,
    fenceFrom: options?.fenceFrom ?? null,
    fenceTo: options?.fenceTo ?? null,
    bodyFrom: options?.bodyFrom ?? null,
    bodyTo: options?.bodyTo ?? null,
  });
  return wrapper;
}

function buildErrorBlock(
  pre: HTMLPreElement,
  source: string,
  message: string,
): HTMLElement {
  const wrapper = buildErrorContent(source, message);
  copyAnchorAttrs(pre, wrapper);
  return wrapper;
}

function buildSuccessBlock(
  pre: HTMLPreElement,
  svg: string,
  source: string,
): HTMLElement {
  const ranges = resolveBodyRangeFromHost(pre, source);
  const wrapper = buildSuccessContent(svg, source, {
    sourceLine: parseSourceLine(pre.getAttribute("data-source-line")),
    fenceFrom: ranges.fenceFrom,
    fenceTo: ranges.fenceTo,
    bodyFrom: ranges.bodyFrom,
    bodyTo: ranges.bodyTo,
  });
  copyAnchorAttrs(pre, wrapper);
  return wrapper;
}

/**
 * Render Mermaid source to SVG without touching the preview generation counter
 * or preview DOM. Used by single-diagram PNG export and fullscreen snapshots.
 */
export async function renderMermaidSvg(source: string): Promise<string> {
  const mermaid = await getMermaid();
  const id = `tomark-mermaid-svg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { svg } = await mermaid.render(id, source);
  if (!svg || !svg.includes("<svg")) {
    throw new Error("Mermaid 未返回有效 SVG");
  }
  return svg;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

/**
 * Render one Mermaid diagram into `host`, replacing its children.
 * Used by the editable-preview NodeView (and tests). Returns false when a newer
 * generation superseded this call (or `isCancelled` became true).
 */
export async function renderMermaidInto(
  host: HTMLElement,
  source: string,
  options?: {
    generation?: number;
    renderId?: string;
    isCancelled?: () => boolean;
    fenceFrom?: number | null;
    fenceTo?: number | null;
    bodyFrom?: number | null;
    bodyTo?: number | null;
    sourceLine?: number | null;
  },
): Promise<boolean> {
  const cancelled = (): boolean => {
    if (options?.isCancelled?.()) {
      return true;
    }
    if (options?.generation !== undefined) {
      return options.generation !== currentMermaidGeneration();
    }
    return false;
  };

  let generation: number | undefined = options?.generation;
  if (generation === undefined && !options?.isCancelled) {
    generation = bumpMermaidGeneration();
  } else if (generation !== undefined) {
    adoptMermaidGeneration(generation);
  }

  const renderId =
    options?.renderId ??
    `tomark-mermaid-${generation ?? "local"}-${Math.random().toString(36).slice(2, 8)}`;

  let mermaid: MermaidModule;
  try {
    mermaid = await getMermaid();
  } catch (err) {
    if (cancelled() || !host.isConnected) {
      return false;
    }
    host.replaceChildren(
      buildErrorContent(source, `无法加载 Mermaid：${errorMessage(err)}`),
    );
    return !cancelled();
  }

  if (cancelled() || !host.isConnected) {
    return false;
  }

  try {
    const { svg } = await mermaid.render(renderId, source);
    if (cancelled() || !host.isConnected) {
      return false;
    }
    const hostRanges = resolveBodyRangeFromHost(host, source);
    const wrapper = buildSuccessContent(svg, source, {
      sourceLine: options?.sourceLine ?? null,
      fenceFrom: options?.fenceFrom ?? hostRanges.fenceFrom,
      fenceTo: options?.fenceTo ?? hostRanges.fenceTo,
      bodyFrom: options?.bodyFrom ?? hostRanges.bodyFrom,
      bodyTo: options?.bodyTo ?? hostRanges.bodyTo,
    });
    host.replaceChildren(wrapper);
  } catch (err) {
    if (cancelled() || !host.isConnected) {
      return false;
    }
    host.replaceChildren(buildErrorContent(source, errorMessage(err)));
  }

  return !cancelled();
}

/**
 * Scan preview DOM for mermaid fenced blocks and render them in place.
 * Returns false if a newer render generation superseded this call.
 */
export async function renderMermaidInRoot(
  root: HTMLElement,
  options?: { generation?: number },
): Promise<boolean> {
  let generation: number;
  if (options?.generation === undefined) {
    generation = bumpMermaidGeneration();
  } else {
    generation = options.generation;
    adoptMermaidGeneration(generation);
  }

  const blocks = collectMermaidBlocks(root);
  if (blocks.length === 0) {
    return generation === currentMermaidGeneration();
  }

  let mermaid: MermaidModule;
  try {
    mermaid = await getMermaid();
  } catch (err) {
    if (generation !== currentMermaidGeneration()) {
      return false;
    }
    for (const { pre, source } of blocks) {
      if (!pre.isConnected) {
        continue;
      }
      pre.replaceWith(
        buildErrorBlock(pre, source, `无法加载 Mermaid：${errorMessage(err)}`),
      );
    }
    return generation === currentMermaidGeneration();
  }

  if (generation !== currentMermaidGeneration()) {
    return false;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    if (generation !== currentMermaidGeneration()) {
      return false;
    }
    const { pre, source } = blocks[index];
    if (!pre.isConnected) {
      continue;
    }
    const id = `tomark-mermaid-${generation}-${index}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (generation !== currentMermaidGeneration() || !pre.isConnected) {
        return false;
      }
      pre.replaceWith(buildSuccessBlock(pre, svg, source));
    } catch (err) {
      if (generation !== currentMermaidGeneration() || !pre.isConnected) {
        return false;
      }
      pre.replaceWith(buildErrorBlock(pre, source, errorMessage(err)));
    }
  }

  return generation === currentMermaidGeneration();
}

/**
 * Render Mermaid fences for export without touching the preview generation
 * counter (so an in-flight preview render is not cancelled mid-export).
 */
export async function renderMermaidForExport(
  root: HTMLElement,
): Promise<string[]> {
  const blocks = collectMermaidBlocks(root);
  if (blocks.length === 0) {
    return [];
  }

  const failures: string[] = [];
  let mermaid: MermaidModule;
  try {
    mermaid = await getMermaid();
  } catch (err) {
    const message = `无法加载 Mermaid：${errorMessage(err)}`;
    for (const { pre, source } of blocks) {
      if (!pre.isConnected) {
        continue;
      }
      pre.replaceWith(buildErrorBlock(pre, source, message));
      failures.push(message);
    }
    return failures;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const { pre, source } = blocks[index];
    if (!pre.isConnected) {
      continue;
    }
    const id = `tomark-export-mermaid-${Date.now()}-${index}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (!pre.isConnected) {
        continue;
      }
      pre.replaceWith(buildSuccessBlock(pre, svg, source));
    } catch (err) {
      if (!pre.isConnected) {
        continue;
      }
      const message = errorMessage(err);
      pre.replaceWith(buildErrorBlock(pre, source, message));
      failures.push(message);
    }
  }
  return failures;
}

/** Bump generation so in-flight renders are discarded. */
export function invalidateMermaidRenders(): number {
  return bumpMermaidGeneration();
}

export { currentMermaidGeneration };

export function hasMermaidBlocks(root: ParentNode): boolean {
  return collectMermaidBlocks(root).length > 0;
}
