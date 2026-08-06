import { describe, expect, it, vi, afterEach } from "vitest";
import { nextTick, ref } from "vue";
import { useDocumentStats } from "@/app/useDocumentStats";

describe("useDocumentStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates small documents immediately", async () => {
    const content = ref("a");
    const { label } = useDocumentStats(content, { largeDocChars: 10 });
    expect(label.value).toContain("行 1");

    content.value = "a\nb";
    await nextTick();
    expect(label.value).toBe("行 2 · 字符 3 · 词 2");
  });

  it("debounces updates for large documents", async () => {
    vi.useFakeTimers();
    const content = ref("x".repeat(20));
    const { label } = useDocumentStats(content, {
      largeDocChars: 10,
      debounceMs: 100,
    });

    content.value = `${"y".repeat(20)}\nz`;
    await nextTick();
    // Still previous stats until debounce fires.
    expect(label.value).toBe(`行 1 · 字符 20 · 词 1`);

    vi.advanceTimersByTime(100);
    await nextTick();
    expect(label.value).toBe("行 2 · 字符 22 · 词 2");
  });
});
