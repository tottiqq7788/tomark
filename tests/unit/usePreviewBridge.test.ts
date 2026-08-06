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

    const scrolls: number[] = [];
    bridge.attachPreview({
      async scrollToSourceLine(line: number) {
        scrolls.push(line);
      },
    });

    content.value = "plain paragraph";
    await bridge.locate(1);
    await nextTick();

    expect(scrolls).toEqual([1]);
    expect(bridge.lineToAnchor.value.get(1)?.blockType).toBe("p");
    vi.useRealTimers();
  });

  it("does not scroll a superseded locate when a newer locate starts", async () => {
    vi.useFakeTimers();
    const content = ref(`# A\n\npara A\n\n# B\n\npara B\n`);
    const bridge = usePreviewBridge(content);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    const scrolls: number[] = [];
    bridge.attachPreview({
      async scrollToSourceLine(line: number) {
        scrolls.push(line);
      },
    });

    const first = bridge.locate(1);
    const second = bridge.locate(5);
    await Promise.all([first, second]);
    await nextTick();

    expect(scrolls).toEqual([5]);
    vi.useRealTimers();
  });

  it("queues locate until preview is attached", async () => {
    vi.useFakeTimers();
    const content = ref("hello\n");
    const bridge = usePreviewBridge(content);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    const scrolls: number[] = [];
    await bridge.locate(1);
    expect(scrolls).toEqual([]);

    bridge.attachPreview({
      async scrollToSourceLine(line: number) {
        scrolls.push(line);
      },
    });
    await flushPromises();
    expect(scrolls).toEqual([1]);
    vi.useRealTimers();
  });
});
