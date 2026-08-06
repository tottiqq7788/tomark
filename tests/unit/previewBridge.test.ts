import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";

vi.mock("@/markdown/renderMarkdown", () => ({
  renderMarkdown: (source: string) => ({
    html: source ? `<p>${source}</p>` : "",
    lineToAnchor: new Map(),
    anchors: [],
  }),
}));

import { usePreviewBridge } from "@/app/usePreviewBridge";

describe("usePreviewBridge", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders immediately when content jumps from empty to a file body", async () => {
    const content = ref("");
    const bridge = usePreviewBridge(content);
    await flushPromises();

    content.value = "# Hello from disk\n\nbody".repeat(50);
    await flushPromises();

    expect(bridge.html.value).toContain("Hello from disk");
  });
});
