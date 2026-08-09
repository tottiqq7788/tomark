import { describe, expect, it } from "vitest";
import {
  createMermaidViewportState,
  fitMermaidViewport,
  mermaidViewportStageStyle,
  panMermaidViewport,
  resetMermaidViewport,
  zoomMermaidViewportIn,
  zoomMermaidViewportOut,
} from "@/preview/useMermaidViewport";

describe("useMermaidViewport", () => {
  const natural = { width: 200, height: 100 };
  // Viewport smaller than natural so fitScale < 1 and 100% can pan.
  const viewport = { width: 160, height: 120 };

  it("fits, resets to 100%, zooms, and pans", () => {
    let state = createMermaidViewportState(natural, viewport);
    expect(state.mode).toBe("fit");
    expect(state.scale).toBeCloseTo(state.fitScale);
    expect(state.fitScale).toBeLessThan(1);
    expect(state.panX).toBe(0);

    state = resetMermaidViewport(state);
    expect(state.mode).toBe("manual");
    expect(state.scale).toBe(1);

    const before = state.scale;
    state = zoomMermaidViewportIn(state);
    expect(state.scale).toBeGreaterThan(before);
    state = zoomMermaidViewportOut(state);
    expect(state.scale).toBeCloseTo(before);

    state = panMermaidViewport(state, 12, -8);
    expect(state.panX).toBe(12);
    expect(state.panY).toBe(-8);

    state = fitMermaidViewport(state);
    expect(state.mode).toBe("fit");
    expect(state.panX).toBe(0);
    const fitStyle = mermaidViewportStageStyle(state);
    expect(fitStyle.width).toBe(`${natural.width * state.scale}px`);
    expect(fitStyle.height).toBe(`${natural.height * state.scale}px`);
    expect(fitStyle.transform).toContain("translate(");
    expect(fitStyle.transform).not.toContain("scale(");

    state = zoomMermaidViewportIn(state);
    const zoomed = mermaidViewportStageStyle(state);
    expect(Number.parseFloat(zoomed.width)).toBeGreaterThan(
      Number.parseFloat(fitStyle.width),
    );
  });


  it("allows pan at fit scale (initial load / after zoom-out)", () => {
    const state = createMermaidViewportState(natural, viewport);
    expect(state.scale).toBeCloseTo(state.fitScale);
    const next = panMermaidViewport(state, 40, -20);
    expect(next.mode).toBe("manual");
    expect(next.panX).toBe(40);
    expect(next.panY).toBe(-20);
  });
});
