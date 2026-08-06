import { describe, expect, it } from "vitest";
import {
  nextViewMode,
  useViewMode,
  viewModeLabel,
} from "@/app/useViewMode";

describe("useViewMode", () => {
  it("defaults to split with both panes and splitter", () => {
    const { mode, label, isSourceVisible, isPreviewVisible, showSplitter } =
      useViewMode();
    expect(mode.value).toBe("split");
    expect(label.value).toBe("源码/渲染");
    expect(isSourceVisible.value).toBe(true);
    expect(isPreviewVisible.value).toBe(true);
    expect(showSplitter.value).toBe(true);
  });

  it("cycles split → source → preview → split", () => {
    expect(nextViewMode("split")).toBe("source");
    expect(nextViewMode("source")).toBe("preview");
    expect(nextViewMode("preview")).toBe("split");

    const { mode, cycle, isSourceVisible, isPreviewVisible, showSplitter } =
      useViewMode();
    cycle();
    expect(mode.value).toBe("source");
    expect(isSourceVisible.value).toBe(true);
    expect(isPreviewVisible.value).toBe(false);
    expect(showSplitter.value).toBe(false);

    cycle();
    expect(mode.value).toBe("preview");
    expect(isSourceVisible.value).toBe(false);
    expect(isPreviewVisible.value).toBe(true);
    expect(showSplitter.value).toBe(false);

    cycle();
    expect(mode.value).toBe("split");
    expect(showSplitter.value).toBe(true);
  });

  it("exposes human labels", () => {
    expect(viewModeLabel("source")).toBe("源码");
    expect(viewModeLabel("preview")).toBe("渲染");
  });
});
