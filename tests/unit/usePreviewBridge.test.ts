import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { usePreviewBridge } from "@/app/usePreviewBridge";

describe("usePreviewBridge", () => {
  it("renders synchronously before locating a source line", async () => {
    vi.useFakeTimers();
    const content = ref("# Title\n\npara\n");
    const bridge = usePreviewBridge(content);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    const scrolls: Array<PreviewAnchorLike | undefined> = [];
    bridge.previewRef.value = {
      async scrollToSourceLine(line: number) {
        scrolls.push(bridge.lineToAnchor.value.get(line));
      },
    };

    content.value = "plain paragraph";
    await bridge.locate(1);
    await nextTick();

    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]?.blockType).toBe("p");
    vi.useRealTimers();
  });
});

type PreviewAnchorLike = { blockType: string };
