import { describe, expect, it } from "vitest";
import { buildMermaidVisualEditTransaction } from "@/preview/mermaidEditing/mermaidEditCommit";

const body = `flowchart TD
  A[Start] --> B[End]
`;

describe("buildMermaidVisualEditTransaction", () => {
  it("builds a fence-body-only mermaid-visual transaction", () => {
    const markdown = `Intro\n\n\`\`\`mermaid\n${body}\`\`\`\n`;
    const bodyFrom = markdown.indexOf(body);
    const next = body.replace("Start", "开始");
    const built = buildMermaidVisualEditTransaction(markdown, 3, {
      revision: 3,
      bodyFrom,
      bodyTo: bodyFrom + body.length,
      expectedText: body,
      nextText: next,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.transaction.origin).toBe("mermaid-visual");
    expect(built.transaction.patches).toEqual([
      {
        from: bodyFrom,
        to: bodyFrom + body.length,
        insert: next,
        expectedText: body,
      },
    ]);
  });

  it("rejects stale revision, expected mismatch, and unsupported drafts", () => {
    const markdown = `\`\`\`mermaid\n${body}\`\`\`\n`;
    const bodyFrom = markdown.indexOf(body);
    expect(
      buildMermaidVisualEditTransaction(markdown, 1, {
        revision: 0,
        bodyFrom,
        bodyTo: bodyFrom + body.length,
        expectedText: body,
        nextText: body.replace("Start", "X"),
      }).ok,
    ).toBe(false);

    expect(
      buildMermaidVisualEditTransaction(markdown, 1, {
        revision: 1,
        bodyFrom,
        bodyTo: bodyFrom + body.length,
        expectedText: "stale",
        nextText: body.replace("Start", "X"),
      }).ok,
    ).toBe(false);

    expect(
      buildMermaidVisualEditTransaction(markdown, 1, {
        revision: 1,
        bodyFrom,
        bodyTo: bodyFrom + body.length,
        expectedText: body,
        nextText: `sequenceDiagram\n  A->>B: hi\n`,
      }).ok,
    ).toBe(false);
  });
});
