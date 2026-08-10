import { describe, expect, it } from "vitest";
import {
  addFlowLink,
  addFlowNode,
  analyzeFlowchartEditability,
  deleteFlowEdge,
  deleteFlowNode,
  findFlowEdgeByDataId,
  findFlowNodeByDomId,
  parseFlowchartSource,
  resolveMermaidFenceBodyRange,
  updateFlowEdgeText,
  updateFlowNodeText,
} from "@/preview/mermaidEditing/flowchartSourceModel";

describe("flowchartSourceModel", () => {
  it("accepts a simple flowchart and rejects sequence diagrams", () => {
    const ok = parseFlowchartSource(`flowchart TD
  Start[开始] --> Decision{是否通过?}
  Decision -->|是| Ok[继续]
`);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.model.capability.editable).toBe(true);
      expect(ok.model.nodes.map((n) => n.id).sort()).toEqual(
        ["Decision", "Ok", "Start"].sort(),
      );
      expect(ok.model.edges).toHaveLength(2);
    }

    const seq = analyzeFlowchartEditability(`sequenceDiagram
  A->>B: hi
`);
    expect(seq.editable).toBe(false);
    expect(seq.reason).toBe("not-flowchart");
  });

  it("rejects subgraph, style, chains, and init directives", () => {
    expect(
      analyzeFlowchartEditability(`flowchart TD
  subgraph S
  A-->B
  end
`).editable,
    ).toBe(false);
    expect(
      analyzeFlowchartEditability(`flowchart TD
  A-->B
  style A fill:#f9f
`).reason,
    ).toBe("unsupported-keyword");
    expect(
      analyzeFlowchartEditability(`flowchart TD
  A-->B-->C
`).reason,
    ).toBe("chain-or-parallel");
    expect(
      analyzeFlowchartEditability(`%%{init: {"theme":"dark"}}%%
flowchart TD
  A-->B
`).reason,
    ).toBe("unsupported-directive");
  });

  it("preserves shape, quotes, comments and CRLF when updating labels", () => {
    const source = `flowchart TD\r\n  %% note\r\n  A((圆形)) -->|go| B{菱形}\r\n`;
    const next = updateFlowNodeText(source, "A", "圆 形");
    expect(next).toContain('A(("圆 形"))');
    expect(next).toContain("%% note");
    expect(next).toContain("\r\n");

    const edgeId = parseFlowchartSource(source);
    expect(edgeId.ok).toBe(true);
    if (!edgeId.ok) {
      return;
    }
    const updated = updateFlowEdgeText(source, edgeId.model.edges[0]!.id, "走");
    expect(updated).toContain("-->|走|");
    expect(updated).toContain("A((圆形))");
  });

  it("adds nodes and links, deletes nodes and edges", () => {
    let source = `flowchart TD
  A[Start] --> B[End]
`;
    source = addFlowNode(source, "中间")!;
    expect(source).toMatch(/C\["中间"\]/);
    source = addFlowLink(source, "A", "C")!;
    expect(source).toContain("A --> C");

    const parsed = parseFlowchartSource(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const edge = parsed.model.edges.find((e) => e.start === "A" && e.end === "B")!;
    source = deleteFlowEdge(source, edge.id)!;
    expect(source).not.toContain("A --> B");
    expect(source).toContain('A[Start]');
    expect(source).toContain('B[End]');

    source = deleteFlowNode(source, "C")!;
    expect(source).not.toContain("中间");
    expect(parseFlowchartSource(source).ok).toBe(true);
  });

  it("resolves fence body ranges and DOM ids", () => {
    const md = "```mermaid\nflowchart TD\nA-->B\n```\n";
    const body = "flowchart TD\nA-->B\n";
    // fence ends before trailing \n after closing ```
    const fenceTo = md.indexOf("```", 3) + 3;
    const resolved = resolveMermaidFenceBodyRange(md, 0, fenceTo, body);
    expect(resolved).toEqual({ from: "```mermaid\n".length, to: "```mermaid\n".length + body.length });

    const model = parseFlowchartSource(body);
    expect(model.ok).toBe(true);
    if (!model.ok) {
      return;
    }
    expect(findFlowNodeByDomId(model.model, "x-flowchart-A-0")?.id).toBe("A");
    expect(
      findFlowEdgeByDataId(model.model, "L_A_B_0")?.start,
    ).toBe("A");
  });
});
