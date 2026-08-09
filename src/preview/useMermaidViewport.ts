export type MermaidViewportMode = "fit" | "manual";

export interface MermaidViewportSize {
  width: number;
  height: number;
}

export interface MermaidViewportState {
  mode: MermaidViewportMode;
  scale: number;
  panX: number;
  panY: number;
  fitScale: number;
  naturalWidth: number;
  naturalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

const FIT_PADDING = 32;
const MIN_SCALE_FACTOR = 0.25;
const MAX_SCALE_FACTOR = 8;
const ZOOM_STEP = 1.25;

export function computeFitScale(
  natural: MermaidViewportSize,
  viewport: MermaidViewportSize,
  padding = FIT_PADDING,
): number {
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const nw = Math.max(1, natural.width);
  const nh = Math.max(1, natural.height);
  return Math.min(availW / nw, availH / nh);
}

export function createMermaidViewportState(
  natural: MermaidViewportSize,
  viewport: MermaidViewportSize,
): MermaidViewportState {
  const fitScale = computeFitScale(natural, viewport);
  return {
    mode: "fit",
    scale: fitScale,
    panX: 0,
    panY: 0,
    fitScale,
    naturalWidth: Math.max(1, natural.width),
    naturalHeight: Math.max(1, natural.height),
    viewportWidth: Math.max(1, viewport.width),
    viewportHeight: Math.max(1, viewport.height),
  };
}

function clampScale(state: MermaidViewportState, scale: number): number {
  const min = state.fitScale * MIN_SCALE_FACTOR;
  const max = Math.max(min, state.fitScale * MAX_SCALE_FACTOR);
  return Math.min(max, Math.max(min, scale));
}

export function resizeMermaidViewport(
  state: MermaidViewportState,
  viewport: MermaidViewportSize,
): MermaidViewportState {
  const next = {
    ...state,
    viewportWidth: Math.max(1, viewport.width),
    viewportHeight: Math.max(1, viewport.height),
  };
  next.fitScale = computeFitScale(
    { width: next.naturalWidth, height: next.naturalHeight },
    { width: next.viewportWidth, height: next.viewportHeight },
  );
  if (next.mode === "fit") {
    next.scale = next.fitScale;
    next.panX = 0;
    next.panY = 0;
  } else {
    next.scale = clampScale(next, next.scale);
  }
  return next;
}

export function fitMermaidViewport(
  state: MermaidViewportState,
): MermaidViewportState {
  return {
    ...state,
    mode: "fit",
    scale: state.fitScale,
    panX: 0,
    panY: 0,
  };
}

/** Reset to 100% of natural size (not fit). */
export function resetMermaidViewport(
  state: MermaidViewportState,
): MermaidViewportState {
  return {
    ...state,
    mode: "manual",
    scale: clampScale(state, 1),
    panX: 0,
    panY: 0,
  };
}

export function zoomMermaidViewport(
  state: MermaidViewportState,
  factor: number,
  focal?: { x: number; y: number },
): MermaidViewportState {
  const nextScale = clampScale(state, state.scale * factor);
  if (nextScale === state.scale) {
    return { ...state, mode: "manual" };
  }
  const ratio = nextScale / state.scale;
  let panX = state.panX;
  let panY = state.panY;
  if (focal) {
    // Keep the focal point (viewport coords relative to content origin) stable.
    panX = focal.x - (focal.x - state.panX) * ratio;
    panY = focal.y - (focal.y - state.panY) * ratio;
  }
  return {
    ...state,
    mode: "manual",
    scale: nextScale,
    panX,
    panY,
  };
}

export function zoomMermaidViewportIn(
  state: MermaidViewportState,
): MermaidViewportState {
  return zoomMermaidViewport(state, ZOOM_STEP);
}

export function zoomMermaidViewportOut(
  state: MermaidViewportState,
): MermaidViewportState {
  return zoomMermaidViewport(state, 1 / ZOOM_STEP);
}

export function panMermaidViewport(
  state: MermaidViewportState,
  dx: number,
  dy: number,
): MermaidViewportState {
  return {
    ...state,
    mode: "manual",
    panX: state.panX + dx,
    panY: state.panY + dy,
  };
}

/**
 * Layout style for the stage: zoom by resizing the SVG box (keeps vectors sharp),
 * pan with translate only. Avoid CSS `scale()` — browsers often rasterize first
 * then stretch, which looks blurry when zooming in.
 */
export function mermaidViewportStageStyle(state: MermaidViewportState): {
  width: string;
  height: string;
  transform: string;
} {
  const width = state.naturalWidth * state.scale;
  const height = state.naturalHeight * state.scale;
  const centerX = state.viewportWidth / 2 + state.panX;
  const centerY = state.viewportHeight / 2 + state.panY;
  return {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(${centerX - width / 2}px, ${centerY - height / 2}px)`,
  };
}

/** @deprecated Prefer mermaidViewportStageStyle; kept for call-site compatibility. */
export function mermaidViewportTransform(
  state: MermaidViewportState,
): string {
  return mermaidViewportStageStyle(state).transform;
}

export function parseSvgNaturalSize(svg: SVGSVGElement | string): MermaidViewportSize {
  if (typeof svg === "string") {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const el = doc.documentElement;
    if (!(el instanceof SVGSVGElement) && el.tagName.toLowerCase() !== "svg") {
      return { width: 400, height: 300 };
    }
    return parseSvgNaturalSize(el as unknown as SVGSVGElement);
  }
  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  const widthAttr = Number.parseFloat(svg.getAttribute("width") || "");
  const heightAttr = Number.parseFloat(svg.getAttribute("height") || "");
  if (Number.isFinite(widthAttr) && Number.isFinite(heightAttr) && widthAttr > 0 && heightAttr > 0) {
    return { width: widthAttr, height: heightAttr };
  }
  try {
    const box = svg.getBBox();
    if (box.width > 0 && box.height > 0) {
      return { width: box.width, height: box.height };
    }
  } catch {
    // getBBox can throw when not in document.
  }
  return { width: 400, height: 300 };
}
