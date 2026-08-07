import { renderMermaidInRoot } from "@/preview/renderMermaid";

/**
 * Entry used by PreviewPane via dynamic import so the mermaid package stays off
 * the preview pane module graph until a diagram fence is present.
 */
export async function mountMermaidDiagrams(
  root: HTMLElement,
  generation: number,
): Promise<void> {
  await renderMermaidInRoot(root, { generation });
}
