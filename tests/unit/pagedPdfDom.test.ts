import { describe, expect, it } from "vitest";
import { exportPagedPdfCss, exportShellCss } from "@/export/buildExportHtml";
import {
  preparePagedExportDom,
  replaceTaskListCheckboxes,
  PDF_PAGED_CONTENT_HEIGHT_PX,
} from "@/export/runExport";

describe("paged PDF DOM preparation", () => {
  it("replaces task-list checkboxes with unicode markers before PDF paint", () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <ul class="contains-task-list">
        <li class="task-list-item"><input type="checkbox" checked disabled> done</li>
        <li class="task-list-item"><input type="checkbox" disabled> todo</li>
      </ul>
    `;
    replaceTaskListCheckboxes(root);
    expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const markers = [...root.querySelectorAll(".pdf-task-marker")].map(
      (el) => el.textContent,
    );
    expect(markers).toEqual(["☑ ", "☐ "]);
  });

  it("wraps standalone images with captions as atomic figures", () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <p><img src="data:image/png;base64,aaa" alt="chart"></p>
      <p>图注：<strong>示例</strong><a href="https://example.com">图例</a></p>
      <pre>short()\n</pre>
      <table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
    `;
    preparePagedExportDom(root);

    const figure = root.querySelector("figure.pdf-atomic");
    expect(figure).toBeTruthy();
    expect(figure?.querySelector("img")).toBeTruthy();
    expect(figure?.querySelector("figcaption")?.textContent).toContain("图注");
    expect(figure?.querySelector("figcaption strong")?.textContent).toBe("示例");
    expect(figure?.querySelector("figcaption a")?.textContent).toBe("图例");
    expect(root.querySelector("pre")?.classList.contains("pdf-atomic")).toBe(true);
    expect(root.querySelector("table")?.classList.contains("pdf-flow")).toBe(true);
  });

  it("marks tall code blocks as flow and shrinks oversized images", () => {
    const root = document.createElement("article");
    const pre = document.createElement("pre");
    pre.textContent = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    Object.defineProperty(pre, "scrollHeight", { value: PDF_PAGED_CONTENT_HEIGHT_PX * 2 });
    root.appendChild(pre);

    const img = document.createElement("img");
    img.src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    Object.defineProperty(img, "scrollHeight", { value: PDF_PAGED_CONTENT_HEIGHT_PX * 1.5 });
    Object.defineProperty(img, "naturalHeight", { value: 2000 });
    Object.defineProperty(img, "naturalWidth", { value: 800 });
    Object.defineProperty(img, "clientWidth", { value: 800 });
    const paragraph = document.createElement("p");
    paragraph.appendChild(img);
    root.appendChild(paragraph);

    preparePagedExportDom(root);
    expect(pre.classList.contains("pdf-flow")).toBe(true);
    expect(img.style.maxHeight).toMatch(/px$/);
  });

  it("includes paged CSS break rules without duplicating page margins", () => {
    const css = exportPagedPdfCss();
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain("break-after: avoid");
    expect(css).toContain("export-root-paged");
    expect(css).not.toContain("@page");
    expect(exportShellCss()).toContain("920px");
  });

  it("uses pure-black body text and export-appropriate font sizes", () => {
    expect(exportShellCss()).toContain("color: #000000");
    expect(exportShellCss()).toContain("font-size: 14px");
    expect(exportPagedPdfCss()).toContain("color: #000000");
    expect(exportPagedPdfCss()).toContain("font-size: 11pt");
  });
});
