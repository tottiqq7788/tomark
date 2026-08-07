/** Isolated dynamic import so Vite can keep mermaid off the preview critical path. */
export async function loadMermaid() {
  return import("mermaid");
}
