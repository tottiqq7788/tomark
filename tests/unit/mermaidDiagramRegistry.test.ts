import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __hasMermaidDiagramRegistrationForTests,
  getMermaidDiagramContext,
  registerMermaidDiagram,
  resolveMermaidDiagramFromTarget,
} from "@/preview/mermaidDiagramRegistry";
import {
  __resetMermaidStateForTests,
  __setMermaidLoaderForTests,
  renderMermaidInRoot,
  renderMermaidInto,
} from "@/preview/renderMermaid";

describe("mermaidDiagramRegistry", () => {
  beforeEach(() => {
    __resetMermaidStateForTests();
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => ({
          svg: `<svg data-testid="reg"></svg>`,
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

  it("stores authoritative source snapshots without data-* leakage", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-diagram";
    wrapper.setAttribute("data-mermaid", "1");
    wrapper.innerHTML = "<svg></svg>";
    registerMermaidDiagram(wrapper, {
      source: "graph TD\nA-->B",
      svg: "<svg></svg>",
      sourceLine: 3,
    });
    expect(wrapper.getAttribute("data-mermaid-source")).toBeNull();
    expect(getMermaidDiagramContext(wrapper)?.source).toContain("graph TD");
    expect(__hasMermaidDiagramRegistrationForTests(wrapper)).toBe(true);
  });

  it("resolves successful diagrams and ignores error blocks", () => {
    const ok = document.createElement("div");
    ok.className = "mermaid-diagram";
    ok.setAttribute("data-mermaid", "1");
    ok.innerHTML = "<svg></svg>";
    registerMermaidDiagram(ok, {
      source: "graph TD\nA-->B",
      svg: "<svg></svg>",
      sourceLine: 1,
    });
    const svg = ok.querySelector("svg");
    expect(resolveMermaidDiagramFromTarget(svg)?.context.source).toContain(
      "A-->B",
    );

    const err = document.createElement("div");
    err.className = "mermaid-diagram mermaid-error";
    err.setAttribute("data-mermaid-error", "1");
    err.innerHTML = "<svg></svg>";
    expect(resolveMermaidDiagramFromTarget(err.querySelector("svg"))).toBeNull();
  });

  it("registers both fallback root and editable into paths", async () => {
    const fallback = document.createElement("div");
    fallback.innerHTML = `<pre data-source-line="2"><code class="language-mermaid">graph TD
A-->B</code></pre>`;
    document.body.appendChild(fallback);
    await renderMermaidInRoot(fallback);
    const fallbackDiagram = fallback.querySelector(
      ".mermaid-diagram[data-mermaid='1']",
    ) as HTMLElement | null;
    expect(fallbackDiagram).toBeTruthy();
    expect(getMermaidDiagramContext(fallbackDiagram!)?.source).toContain(
      "graph TD",
    );

    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderMermaidInto(host, "pie title T\n\"A\": 1");
    const editableDiagram = host.querySelector(
      ".mermaid-diagram[data-mermaid='1']",
    ) as HTMLElement | null;
    expect(editableDiagram).toBeTruthy();
    expect(getMermaidDiagramContext(editableDiagram!)?.source).toContain("pie");
  });
});
