/**
 * Shared render-generation counter for Mermaid preview mounts.
 * Kept in a tiny module so PreviewPane can cancel in-flight work without
 * importing the mermaid package graph.
 */
let renderSeq = 0;

export function bumpMermaidGeneration(): number {
  renderSeq += 1;
  return renderSeq;
}

export function currentMermaidGeneration(): number {
  return renderSeq;
}

/** Raise the shared counter to at least `generation` (never decreases). */
export function adoptMermaidGeneration(generation: number): number {
  if (generation > renderSeq) {
    renderSeq = generation;
  }
  return renderSeq;
}

/** Test-only. */
export function __resetMermaidGenerationForTests() {
  renderSeq = 0;
}
