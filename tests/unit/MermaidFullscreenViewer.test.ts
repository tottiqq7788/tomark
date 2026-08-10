import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MermaidFullscreenViewer from "@/preview/MermaidFullscreenViewer.vue";

const viewerSrc = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/preview/MermaidFullscreenViewer.vue",
  ),
  "utf8",
);

describe("MermaidFullscreenViewer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("traps focus and closes on Escape", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();

    const wrapper = mount(MermaidFullscreenViewer, {
      props: {
        open: true,
        svgHtml:
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>',
      },
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();

    const dialog = document.querySelector(
      '[data-testid="mermaid-fullscreen-viewer"] [role="dialog"]',
    ) as HTMLElement | null;
    expect(dialog).toBeTruthy();
    expect(dialog?.contains(document.activeElement)).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(wrapper.emitted("close")?.length).toBeGreaterThan(0);

    wrapper.unmount();
  });

  it("fills the overlay without a 1120×820 size cap", async () => {
    expect(viewerSrc).toMatch(/\.mermaid-viewer\s*\{[^}]*width:\s*100%/s);
    expect(viewerSrc).toMatch(/\.mermaid-viewer\s*\{[^}]*height:\s*100%/s);
    expect(viewerSrc).toMatch(/\.mermaid-viewer\s*\{[^}]*max-width:\s*none/s);
    expect(viewerSrc).toMatch(/\.mermaid-viewer\s*\{[^}]*max-height:\s*none/s);
    expect(viewerSrc).not.toMatch(/min\(\s*1120px/);
    expect(viewerSrc).not.toMatch(/min\(\s*820px/);

    const wrapper = mount(MermaidFullscreenViewer, {
      props: {
        open: true,
        svgHtml:
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>',
      },
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();

    expect(
      document.querySelector(
        '[data-testid="mermaid-fullscreen-viewer"] [role="dialog"]',
      ),
    ).toBeTruthy();

    wrapper.unmount();
  });
});
