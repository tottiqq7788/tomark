import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ImageFullscreenViewer from "@/preview/ImageFullscreenViewer.vue";

const viewerSrc = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/preview/ImageFullscreenViewer.vue",
  ),
  "utf8",
);

describe("ImageFullscreenViewer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fills the overlay without a 1120×820 size cap", async () => {
    expect(viewerSrc).toMatch(/\.image-viewer\s*\{[^}]*width:\s*100%/s);
    expect(viewerSrc).toMatch(/\.image-viewer\s*\{[^}]*height:\s*100%/s);
    expect(viewerSrc).toMatch(/\.image-viewer\s*\{[^}]*max-width:\s*none/s);
    expect(viewerSrc).toMatch(/\.image-viewer\s*\{[^}]*max-height:\s*none/s);
    expect(viewerSrc).not.toMatch(/min\(\s*1120px/);
    expect(viewerSrc).not.toMatch(/min\(\s*820px/);

    const wrapper = mount(ImageFullscreenViewer, {
      props: {
        open: true,
        imageSrc:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        naturalWidth: 1,
        naturalHeight: 1,
      },
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();

    expect(
      document.querySelector(
        '[data-testid="image-fullscreen-viewer"] [role="dialog"]',
      ),
    ).toBeTruthy();

    wrapper.unmount();
  });
});
