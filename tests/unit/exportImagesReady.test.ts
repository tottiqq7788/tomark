import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForExportImages } from "@/export/runExport";

describe("waitForExportImages", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not continue after the old 50 ms fallback while decode is pending", async () => {
    vi.useFakeTimers();
    let finishDecode = () => {};
    const decode = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(image, "decode", {
      configurable: true,
      value: () => decode,
    });
    root.appendChild(image);

    let settled = false;
    const waiting = waitForExportImages(root).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);

    finishDecode();
    await waiting;
    expect(settled).toBe(true);
  });

  it("uses a bounded fallback for WebViews that never settle an image", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(image, "decode", {
      configurable: true,
      value: () => new Promise<void>(() => {}),
    });
    root.appendChild(image);

    const waiting = waitForExportImages(root, 250);
    await vi.advanceTimersByTimeAsync(249);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
  });
});
