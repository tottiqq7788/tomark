import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMermaidStateForTests,
  __setMermaidLoaderForTests,
  hasMermaidBlocks,
  invalidateMermaidRenders,
  renderMermaidInRoot,
} from "@/preview/renderMermaid";

function mountPreview(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "preview-content markdown-body";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("renderMermaidInRoot", () => {
  beforeEach(() => {
    __resetMermaidStateForTests();
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async (id: string, source: string) => ({
          svg: `<svg data-testid="mermaid-svg" data-id="${id}" data-source="${source.trim()}"></svg>`,
          bindFunctions: undefined,
        })),
      } as never,
    }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __setMermaidLoaderForTests(null);
    __resetMermaidStateForTests();
  });

  it("does not load mermaid when no diagram blocks exist", async () => {
    const loader = vi.fn(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(),
      } as never,
    }));
    __setMermaidLoaderForTests(loader);
    const root = mountPreview("<pre><code class=\"language-js\">x</code></pre>");
    expect(hasMermaidBlocks(root)).toBe(false);
    await renderMermaidInRoot(root);
    expect(loader).not.toHaveBeenCalled();
    expect(root.querySelector("svg")).toBeNull();
  });

  it("renders multiple mermaid blocks with unique ids and migrated anchors", async () => {
    const root = mountPreview(`
      <pre data-source-line="1" data-source-end="3" data-anchor-id="tm-a-1"><code class="language-mermaid">graph TD
A-->B</code></pre>
      <pre data-source-line="5" data-source-end="7" data-anchor-id="tm-a-2"><code class="language-mermaid">pie title T
"A": 1</code></pre>
      <pre data-source-line="9" data-source-end="10" data-anchor-id="tm-a-3"><code class="language-js">const x = 1</code></pre>
    `);

    await renderMermaidInRoot(root);

    const diagrams = root.querySelectorAll(".mermaid-diagram[data-mermaid='1']");
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0].getAttribute("data-anchor-id")).toBe("tm-a-1");
    expect(diagrams[0].getAttribute("data-source-line")).toBe("1");
    expect(diagrams[1].getAttribute("data-anchor-id")).toBe("tm-a-2");
    expect(root.querySelectorAll("svg[data-testid='mermaid-svg']")).toHaveLength(2);
    const ids = [...root.querySelectorAll("svg")].map((el) =>
      el.getAttribute("data-id"),
    );
    expect(new Set(ids).size).toBe(2);
    expect(root.querySelector("code.language-js")).toBeTruthy();
  });

  it("isolates a failed block without breaking siblings", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async (_id: string, source: string) => {
          if (source.includes("BAD")) {
            throw new Error("parse failed");
          }
          return {
            svg: `<svg data-ok="1"></svg>`,
            bindFunctions: undefined,
          };
        }),
      } as never,
    }));

    const root = mountPreview(`
      <pre data-source-line="1" data-anchor-id="a1"><code class="language-mermaid">graph TD
A-->B</code></pre>
      <pre data-source-line="5" data-anchor-id="a2"><code class="language-mermaid">BAD</code></pre>
    `);

    await renderMermaidInRoot(root);

    expect(root.querySelector("[data-mermaid='1'] svg")).toBeTruthy();
    const err = root.querySelector(".mermaid-error");
    expect(err).toBeTruthy();
    expect(err?.getAttribute("data-anchor-id")).toBe("a2");
    expect(err?.textContent).toContain("parse failed");
    expect(err?.querySelector(".mermaid-error-source")?.textContent).toContain(
      "BAD",
    );
  });

  it("discards superseded in-flight renders", async () => {
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;

    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async (id: string) => {
          calls += 1;
          if (calls === 1) {
            await firstGate;
          }
          return {
            svg: `<svg data-id="${id}"></svg>`,
            bindFunctions: undefined,
          };
        }),
      } as never,
    }));

    const root = mountPreview(`
      <pre data-anchor-id="a1"><code class="language-mermaid">graph TD
A-->B</code></pre>
    `);

    const gen1 = invalidateMermaidRenders();
    const first = renderMermaidInRoot(root, { generation: gen1 });
    const gen2 = invalidateMermaidRenders();
    root.innerHTML = `
      <pre data-anchor-id="a2"><code class="language-mermaid">graph TD
C-->D</code></pre>
    `;
    const second = renderMermaidInRoot(root, { generation: gen2 });
    releaseFirst();
    const [firstOk, secondOk] = await Promise.all([first, second]);

    expect(firstOk).toBe(false);
    expect(secondOk).toBe(true);
    expect(root.querySelector("[data-anchor-id='a2'] svg")).toBeTruthy();
    expect(root.querySelector("[data-anchor-id='a1']")).toBeNull();
  });
});
