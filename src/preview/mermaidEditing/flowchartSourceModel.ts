/**
 * Lossless flowchart source model for a safe Mermaid subset.
 *
 * Authority is the Mermaid fence body string. Mutations rewrite only the
 * touched UTF-16 slices and preserve comments, indentation, newlines, and
 * node shape delimiters. Unsupported constructs mark the whole diagram
 * non-editable — never guess.
 */

export type FlowNodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "circle"
  | "diamond"
  | "subroutine"
  | "asymmetric"
  | "hexagon"
  | "cylinder";

export type FlowArrowKind = "arrow" | "line" | "dotted" | "thick";

export interface SourceSpan {
  readonly from: number;
  readonly to: number;
}

export interface FlowNodeDef {
  readonly id: string;
  readonly text: string;
  readonly shape: FlowNodeShape;
  /** Full `ID[text]` (or shape variant) span when an explicit definition exists. */
  readonly defSpan: SourceSpan | null;
  /** Inner label span inside shape delimiters; null when only referenced by edges. */
  readonly textSpan: SourceSpan | null;
  readonly quoted: boolean;
}

export interface FlowEdgeDef {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly text: string;
  readonly arrow: FlowArrowKind;
  /** Entire statement span (one physical line including its newline if any). */
  readonly statementSpan: SourceSpan;
  /** Label text span when present; otherwise null. */
  readonly labelSpan: SourceSpan | null;
  readonly labelStyle: "pipe" | "mid" | null;
}

export type FlowchartCapabilityRejectReason =
  | "empty"
  | "not-flowchart"
  | "unsupported-directive"
  | "unsupported-keyword"
  | "subgraph"
  | "chain-or-parallel"
  | "ambiguous-node"
  | "unparsed-statement"
  | "complex-label"
  | "invalid-id";

export interface FlowchartCapability {
  readonly editable: boolean;
  readonly reason: FlowchartCapabilityRejectReason | null;
  readonly message: string | null;
}

export interface FlowchartSourceModel {
  readonly source: string;
  readonly direction: string;
  readonly headerSpan: SourceSpan;
  readonly nodes: readonly FlowNodeDef[];
  readonly edges: readonly FlowEdgeDef[];
  readonly capability: FlowchartCapability;
}

export type FlowchartParseResult =
  | { readonly ok: true; readonly model: FlowchartSourceModel }
  | {
      readonly ok: false;
      readonly capability: FlowchartCapability;
      readonly source: string;
    };

interface LineInfo {
  readonly from: number;
  readonly to: number;
  readonly content: string;
  readonly contentFrom: number;
}

interface ParsedNodeToken {
  readonly id: string;
  readonly text: string | null;
  readonly shape: FlowNodeShape | null;
  readonly quoted: boolean;
  readonly end: number;
  readonly defSpan: SourceSpan | null;
  readonly textSpan: SourceSpan | null;
}

const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*$/;
/** Match IDs without consuming Mermaid arrow prefixes (`--`, `==`, `-.`). */
const SAFE_ID_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/;
const HEADER_RE =
  /^\s*(graph|flowchart)(?:\s+(TD|TB|BT|RL|LR|DT))?\s*(?:%%.*)?$/i;
const COMMENT_OR_BLANK_RE = /^\s*(?:%%(?!\{).*)?$/;
const INIT_DIRECTIVE_RE = /%%\{[\s\S]*?\}%%/;
const UNSUPPORTED_KEYWORD_RE =
  /^\s*(subgraph|end|style|classDef|class|click|linkStyle|direction)\b/i;

const SHAPE_CLOSE: Record<FlowNodeShape, string> = {
  rect: "]",
  round: ")",
  circle: "))",
  stadium: "])",
  subroutine: "]]",
  cylinder: ")]",
  diamond: "}",
  hexagon: "}}",
  asymmetric: "]",
};

const ARROW_SPECS: Array<{
  kind: FlowArrowKind;
  mid: string;
  end: string;
  bare: RegExp;
}> = [
  { kind: "dotted", mid: "-.", end: ".->", bare: /^-\.->/ },
  { kind: "thick", mid: "==", end: "==>", bare: /^==>/ },
  { kind: "arrow", mid: "--", end: "-->", bare: /^-->/ },
  { kind: "line", mid: "--", end: "---", bare: /^---(?!>)/ },
];

function reject(
  reason: FlowchartCapabilityRejectReason,
  message: string,
): FlowchartCapability {
  return { editable: false, reason, message };
}

function okCapability(): FlowchartCapability {
  return { editable: true, reason: null, message: null };
}

function lineSpans(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let index = 0;
  while (index <= source.length) {
    const next = source.indexOf("\n", index);
    const end = next < 0 ? source.length : next;
    const hasCr = end > index && source[end - 1] === "\r";
    const contentTo = hasCr ? end - 1 : end;
    const to = next < 0 ? source.length : next + 1;
    lines.push({
      from: index,
      to,
      content: source.slice(index, contentTo),
      contentFrom: index,
    });
    if (next < 0) {
      break;
    }
    index = next + 1;
  }
  return lines;
}

function matchShapeOpen(
  input: string,
  at: number,
): { shape: FlowNodeShape; len: number } | null {
  const two = input.slice(at, at + 2);
  if (two === "((") {
    return { shape: "circle", len: 2 };
  }
  if (two === "([") {
    return { shape: "stadium", len: 2 };
  }
  if (two === "[[") {
    return { shape: "subroutine", len: 2 };
  }
  if (two === "[(") {
    return { shape: "cylinder", len: 2 };
  }
  if (two === "{{") {
    return { shape: "hexagon", len: 2 };
  }
  const one = input[at];
  if (one === "{") {
    return { shape: "diamond", len: 1 };
  }
  if (one === ">") {
    return { shape: "asymmetric", len: 1 };
  }
  if (one === "[") {
    return { shape: "rect", len: 1 };
  }
  if (one === "(") {
    return { shape: "round", len: 1 };
  }
  return null;
}

function readQuotedOrRaw(
  input: string,
  start: number,
  closeToken: string,
): {
  text: string;
  quoted: boolean;
  end: number;
  textFrom: number;
  textTo: number;
} | null {
  if (input[start] === '"') {
    let i = start + 1;
    let text = "";
    while (i < input.length) {
      const ch = input[i]!;
      if (ch === '"') {
        const after = i + 1;
        if (!input.startsWith(closeToken, after)) {
          return null;
        }
        return {
          text,
          quoted: true,
          end: after + closeToken.length,
          textFrom: start + 1,
          textTo: i,
        };
      }
      if (ch === "\\" || ch === "\n" || ch === "\r") {
        return null;
      }
      text += ch;
      i += 1;
    }
    return null;
  }
  const closeAt = input.indexOf(closeToken, start);
  if (closeAt < 0) {
    return null;
  }
  const text = input.slice(start, closeAt);
  if (/[\n\r|]/.test(text) || text.includes("```") || /[<`]/.test(text)) {
    return null;
  }
  return {
    text,
    quoted: false,
    end: closeAt + closeToken.length,
    textFrom: start,
    textTo: closeAt,
  };
}

function parseNodeToken(
  input: string,
  from: number,
  absoluteBase: number,
): ParsedNodeToken | null {
  const idMatch = SAFE_ID_TOKEN_RE.exec(input.slice(from));
  if (!idMatch) {
    return null;
  }
  const id = idMatch[0];
  if (!SAFE_ID_RE.test(id)) {
    return null;
  }
  let at = from + id.length;
  while (input[at] === " " || input[at] === "\t") {
    at += 1;
  }
  const open = matchShapeOpen(input, at);
  if (!open) {
    return {
      id,
      text: null,
      shape: null,
      quoted: false,
      end: from + id.length,
      defSpan: null,
      textSpan: null,
    };
  }
  const close = SHAPE_CLOSE[open.shape];
  const body = readQuotedOrRaw(input, at + open.len, close);
  if (!body) {
    return null;
  }
  return {
    id,
    text: body.text,
    shape: open.shape,
    quoted: body.quoted,
    end: body.end,
    defSpan: {
      from: absoluteBase + from,
      to: absoluteBase + body.end,
    },
    textSpan: {
      from: absoluteBase + body.textFrom,
      to: absoluteBase + body.textTo,
    },
  };
}

function detectBareArrow(
  input: string,
  from: number,
): { kind: FlowArrowKind; end: number } | null {
  const slice = input.slice(from);
  for (const spec of ARROW_SPECS) {
    const match = spec.bare.exec(slice);
    if (match) {
      return { kind: spec.kind, end: from + match[0].length };
    }
  }
  return null;
}

function skipWs(input: string, from: number): number {
  let at = from;
  while (input[at] === " " || input[at] === "\t") {
    at += 1;
  }
  return at;
}

type EdgeParseResult =
  | {
      start: ParsedNodeToken;
      end: ParsedNodeToken;
      edge: FlowEdgeDef;
    }
  | { error: FlowchartCapabilityRejectReason; message: string };

function parseEdgeStatement(
  content: string,
  contentFrom: number,
  statementSpan: SourceSpan,
  edgeIndex: number,
): EdgeParseResult | null {
  let at = skipWs(content, 0);
  const start = parseNodeToken(content, at, contentFrom);
  if (!start) {
    return null;
  }
  at = skipWs(content, start.end);

  let arrow: FlowArrowKind | null = null;
  let label = "";
  let labelSpan: SourceSpan | null = null;
  let labelStyle: "pipe" | "mid" | null = null;

  const bare = detectBareArrow(content, at);
  if (bare) {
    arrow = bare.kind;
    at = skipWs(content, bare.end);
    if (content[at] === "|") {
      const labelStart = at + 1;
      const labelEnd = content.indexOf("|", labelStart);
      if (labelEnd < 0) {
        return { error: "complex-label", message: "连线标签缺少闭合 |" };
      }
      label = content.slice(labelStart, labelEnd);
      if (/[\n\r]/.test(label)) {
        return { error: "complex-label", message: "不支持多行连线标签" };
      }
      labelSpan = {
        from: contentFrom + labelStart,
        to: contentFrom + labelEnd,
      };
      labelStyle = "pipe";
      at = skipWs(content, labelEnd + 1);
    }
  } else {
    let matched: {
      kind: FlowArrowKind;
      midLen: number;
      endToken: string;
    } | null = null;
    for (const spec of ARROW_SPECS) {
      if (content.startsWith(spec.mid, at)) {
        matched = {
          kind: spec.kind,
          midLen: spec.mid.length,
          endToken: spec.end,
        };
        break;
      }
    }
    if (!matched) {
      return null;
    }
    const midBodyFrom = skipWs(content, at + matched.midLen);
    const endTokenAt = content.indexOf(matched.endToken, midBodyFrom);
    if (endTokenAt < 0) {
      return { error: "unparsed-statement", message: "无法解析连线箭头" };
    }
    const rawLabel = content.slice(midBodyFrom, endTokenAt);
    const trimmed = rawLabel.trim();
    if (!trimmed) {
      return { error: "unparsed-statement", message: "中间标签连线缺少文本" };
    }
    if (/[\n\r|]/.test(rawLabel)) {
      return { error: "complex-label", message: "不支持的连线标签" };
    }
    const lead = rawLabel.length - rawLabel.trimStart().length;
    arrow = matched.kind;
    label = trimmed;
    labelSpan = {
      from: contentFrom + midBodyFrom + lead,
      to: contentFrom + midBodyFrom + lead + trimmed.length,
    };
    labelStyle = "mid";
    at = skipWs(content, endTokenAt + matched.endToken.length);
  }

  const end = parseNodeToken(content, at, contentFrom);
  if (!end || !arrow) {
    return null;
  }
  at = skipWs(content, end.end);
  if (at < content.length) {
    if (content[at] === "%") {
      if (!COMMENT_OR_BLANK_RE.test(content.slice(at))) {
        return { error: "unparsed-statement", message: "行尾注释格式不受支持" };
      }
    } else if (detectBareArrow(content, at) || content[at] === "&") {
      return {
        error: "chain-or-parallel",
        message: "不支持链式或并行连线语句",
      };
    } else {
      return {
        error: "unparsed-statement",
        message: "语句含有未识别尾部内容",
      };
    }
  }

  return {
    start,
    end,
    edge: {
      id: `E${edgeIndex}_${start.id}_${end.id}`,
      start: start.id,
      end: end.id,
      text: label,
      arrow,
      statementSpan,
      labelSpan,
      labelStyle,
    },
  };
}

function parseNodeOnlyStatement(
  content: string,
  contentFrom: number,
): ParsedNodeToken | { error: FlowchartCapabilityRejectReason; message: string } | null {
  let at = skipWs(content, 0);
  const node = parseNodeToken(content, at, contentFrom);
  if (!node || node.text == null || !node.shape || !node.defSpan) {
    return null;
  }
  at = skipWs(content, node.end);
  if (at < content.length) {
    if (content[at] === "%") {
      if (!COMMENT_OR_BLANK_RE.test(content.slice(at))) {
        return { error: "unparsed-statement", message: "行尾注释格式不受支持" };
      }
    } else {
      return null;
    }
  }
  return node;
}

function upsertNode(
  map: Map<string, FlowNodeDef>,
  token: ParsedNodeToken,
): FlowchartCapability | null {
  const existing = map.get(token.id);
  if (!existing) {
    map.set(token.id, {
      id: token.id,
      text: token.text ?? token.id,
      shape: token.shape ?? "rect",
      defSpan: token.defSpan,
      textSpan: token.textSpan,
      quoted: token.quoted,
    });
    return null;
  }
  if (token.defSpan && existing.defSpan) {
    return reject("ambiguous-node", `节点 ${token.id} 被重复定义`);
  }
  if (token.defSpan && !existing.defSpan) {
    map.set(token.id, {
      id: token.id,
      text: token.text ?? existing.text,
      shape: token.shape ?? existing.shape,
      defSpan: token.defSpan,
      textSpan: token.textSpan,
      quoted: token.quoted,
    });
  }
  return null;
}

function statementSpanFor(line: LineInfo): SourceSpan {
  return { from: line.from, to: line.to };
}

/**
 * Parse Mermaid fence body into a flowchart model, or reject with capability.
 */
export function parseFlowchartSource(source: string): FlowchartParseResult {
  if (!source.trim()) {
    return {
      ok: false,
      source,
      capability: reject("empty", "空的 Mermaid 围栏"),
    };
  }
  if (INIT_DIRECTIVE_RE.test(source)) {
    return {
      ok: false,
      source,
      capability: reject("unsupported-directive", "不支持 Mermaid 配置指令"),
    };
  }

  const lines = lineSpans(source);
  let headerIndex = -1;
  let direction = "TD";
  let headerSpan: SourceSpan | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (COMMENT_OR_BLANK_RE.test(line.content)) {
      continue;
    }
    const header = HEADER_RE.exec(line.content);
    if (!header) {
      return {
        ok: false,
        source,
        capability: reject("not-flowchart", "仅支持 graph/flowchart 图"),
      };
    }
    headerIndex = i;
    direction = (header[2] ?? "TD").toUpperCase();
    headerSpan = {
      from: line.contentFrom,
      to: line.contentFrom + line.content.length,
    };
    break;
  }

  if (headerIndex < 0 || !headerSpan) {
    return {
      ok: false,
      source,
      capability: reject("not-flowchart", "缺少 graph/flowchart 声明"),
    };
  }

  const nodes = new Map<string, FlowNodeDef>();
  const edges: FlowEdgeDef[] = [];

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (COMMENT_OR_BLANK_RE.test(line.content)) {
      continue;
    }
    if (UNSUPPORTED_KEYWORD_RE.test(line.content)) {
      const keyword = line.content.trim().split(/\s+/)[0]!.toLowerCase();
      return {
        ok: false,
        source,
        capability:
          keyword === "subgraph" || keyword === "end"
            ? reject("subgraph", "不支持 subgraph")
            : reject("unsupported-keyword", `不支持关键字 ${keyword}`),
      };
    }

    const stmtSpan = statementSpanFor(line);
    const edgeParsed = parseEdgeStatement(
      line.content,
      line.contentFrom,
      stmtSpan,
      edges.length,
    );
    if (edgeParsed && "error" in edgeParsed) {
      return {
        ok: false,
        source,
        capability: reject(edgeParsed.error, edgeParsed.message),
      };
    }
    if (edgeParsed && "edge" in edgeParsed) {
      const startCap = upsertNode(nodes, edgeParsed.start);
      if (startCap) {
        return { ok: false, source, capability: startCap };
      }
      const endCap = upsertNode(nodes, edgeParsed.end);
      if (endCap) {
        return { ok: false, source, capability: endCap };
      }
      edges.push(edgeParsed.edge);
      continue;
    }

    const nodeParsed = parseNodeOnlyStatement(line.content, line.contentFrom);
    if (nodeParsed && "error" in nodeParsed) {
      return {
        ok: false,
        source,
        capability: reject(nodeParsed.error, nodeParsed.message),
      };
    }
    if (nodeParsed && !("error" in nodeParsed)) {
      const cap = upsertNode(nodes, nodeParsed);
      if (cap) {
        return { ok: false, source, capability: cap };
      }
      continue;
    }

    return {
      ok: false,
      source,
      capability: reject(
        "unparsed-statement",
        `无法安全解析：${line.content.trim()}`,
      ),
    };
  }

  return {
    ok: true,
    model: {
      source,
      direction,
      headerSpan,
      nodes: [...nodes.values()],
      edges,
      capability: okCapability(),
    },
  };
}

export function analyzeFlowchartEditability(source: string): FlowchartCapability {
  const parsed = parseFlowchartSource(source);
  return parsed.ok ? parsed.model.capability : parsed.capability;
}

function formatNodeLabel(text: string, quoted: boolean): string {
  if (quoted || /[\[\](){}>]/.test(text) || /\s/.test(text)) {
    return `"${text.replace(/"/g, "'")}"`;
  }
  return text;
}

function nodeDefText(
  id: string,
  text: string,
  shape: FlowNodeShape,
  quoted: boolean,
): string {
  const open =
    shape === "circle"
      ? "(("
      : shape === "stadium"
        ? "(["
        : shape === "subroutine"
          ? "[["
          : shape === "cylinder"
            ? "[("
            : shape === "hexagon"
              ? "{{"
              : shape === "diamond"
                ? "{"
                : shape === "asymmetric"
                  ? ">"
                  : shape === "round"
                    ? "("
                    : "[";
  return `${id}${open}${formatNodeLabel(text, quoted)}${SHAPE_CLOSE[shape]}`;
}

function lastContentIndent(source: string): string {
  const lines = lineSpans(source);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const content = lines[i]!.content;
    if (COMMENT_OR_BLANK_RE.test(content)) {
      continue;
    }
    return content.match(/^[ \t]*/)?.[0] ?? "";
  }
  return "  ";
}

function replaceSpan(source: string, span: SourceSpan, insert: string): string {
  return source.slice(0, span.from) + insert + source.slice(span.to);
}

function lineEndingOf(statement: string): string {
  if (statement.endsWith("\r\n")) {
    return "\r\n";
  }
  if (statement.endsWith("\n")) {
    return "\n";
  }
  return "";
}

function generateNodeId(existing: Set<string>): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let length = 1; length <= 5; length += 1) {
    const total = Math.pow(chars.length, length);
    for (let n = 0; n < total; n += 1) {
      let value = n;
      let id = "";
      for (let k = 0; k < length; k += 1) {
        id = chars[value % chars.length]! + id;
        value = Math.floor(value / chars.length);
      }
      if (!existing.has(id)) {
        return id;
      }
    }
  }
  throw new Error("无法生成唯一节点 ID");
}

function arrowTokens(kind: FlowArrowKind): {
  bare: string;
  mid: string;
  end: string;
} {
  switch (kind) {
    case "dotted":
      return { bare: "-.->", mid: "-.", end: ".->" };
    case "thick":
      return { bare: "==>", mid: "==", end: "==>" };
    case "line":
      return { bare: "---", mid: "--", end: "---" };
    default:
      return { bare: "-->", mid: "--", end: "-->" };
  }
}

function sliceNodeToken(content: string, token: ParsedNodeToken): string {
  const start = token.defSpan
    ? token.defSpan.from
    : token.end - token.id.length;
  // token spans were absolute; for content-local tokens absoluteBase was contentFrom.
  // Callers pass content-local tokens with absoluteBase 0.
  return content.slice(start, token.end);
}

export function updateFlowNodeText(
  source: string,
  nodeId: string,
  newText: string,
): string | null {
  const parsed = parseFlowchartSource(source);
  if (!parsed.ok) {
    return null;
  }
  const node = parsed.model.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return null;
  }
  const quoted =
    node.quoted || /[\[\](){}>]/.test(newText) || /\s/.test(newText);
  if (node.defSpan) {
    return replaceSpan(
      source,
      node.defSpan,
      nodeDefText(node.id, newText, node.shape, quoted),
    );
  }
  const indent = lastContentIndent(source);
  const prefix = source.endsWith("\n") ? "" : "\n";
  return `${source}${prefix}${indent}${nodeDefText(nodeId, newText, "rect", true)}`;
}

export function updateFlowEdgeText(
  source: string,
  edgeId: string,
  newText: string,
): string | null {
  const parsed = parseFlowchartSource(source);
  if (!parsed.ok) {
    return null;
  }
  const edge = parsed.model.edges.find((item) => item.id === edgeId);
  if (!edge) {
    return null;
  }
  const statement = source.slice(edge.statementSpan.from, edge.statementSpan.to);
  const newline = lineEndingOf(statement);
  const content = newline ? statement.slice(0, -newline.length) : statement;
  const indent = content.match(/^[ \t]*/)?.[0] ?? "";
  const start = parseNodeToken(content, indent.length, 0);
  if (!start) {
    return null;
  }
  // Find last occurrence of end id as a node token.
  let scan = indent.length;
  let endToken: ParsedNodeToken | null = null;
  while (scan < content.length) {
    const ws = skipWs(content, scan);
    if (ws >= content.length) {
      break;
    }
    // Skip arrows / labels roughly by jumping to next id-like token.
    if (!/^[A-Za-z]/.test(content[ws]!)) {
      scan = ws + 1;
      continue;
    }
    const token = parseNodeToken(content, ws, 0);
    if (!token) {
      scan = ws + 1;
      continue;
    }
    if (token.id === edge.end) {
      endToken = token;
    }
    scan = token.end;
  }
  if (!endToken) {
    return null;
  }
  const startSlice = sliceNodeToken(content, start);
  const endSlice = sliceNodeToken(content, endToken);
  const arrows = arrowTokens(edge.arrow);
  const label = newText.trim();
  let rebuilt: string;
  if (!label) {
    rebuilt = `${indent}${startSlice} ${arrows.bare} ${endSlice}`;
  } else if (edge.labelStyle === "mid") {
    rebuilt = `${indent}${startSlice} ${arrows.mid} ${label} ${arrows.end} ${endSlice}`;
  } else {
    rebuilt = `${indent}${startSlice} ${arrows.bare}|${label}| ${endSlice}`;
  }
  return replaceSpan(source, edge.statementSpan, rebuilt + newline);
}

export function addFlowNode(source: string, text: string): string | null {
  const parsed = parseFlowchartSource(source);
  if (!parsed.ok) {
    return null;
  }
  const existing = new Set(parsed.model.nodes.map((node) => node.id));
  const id = generateNodeId(existing);
  const indent = lastContentIndent(source);
  const prefix = source.endsWith("\n") ? "" : "\n";
  return `${source}${prefix}${indent}${nodeDefText(id, text, "rect", true)}`;
}

export function addFlowLink(
  source: string,
  startId: string,
  endId: string,
): string | null {
  const parsed = parseFlowchartSource(source);
  if (!parsed.ok) {
    return null;
  }
  if (startId === endId) {
    return null;
  }
  const ids = new Set(parsed.model.nodes.map((node) => node.id));
  if (!ids.has(startId) || !ids.has(endId)) {
    return null;
  }
  if (
    parsed.model.edges.some(
      (edge) => edge.start === startId && edge.end === endId,
    )
  ) {
    return null;
  }
  const indent = lastContentIndent(source);
  const prefix = source.endsWith("\n") ? "" : "\n";
  return `${source}${prefix}${indent}${startId} --> ${endId}`;
}

function joinLines(source: string, parts: string[]): string {
  let result = parts.join("");
  if (!source.endsWith("\n") && result.endsWith("\n")) {
    result = result.slice(0, -1);
  }
  return result;
}

export function deleteFlowNode(source: string, nodeId: string): string | null {
  const parsed = parseFlowchartSource(source);
  if (!parsed.ok) {
    return null;
  }
  if (!parsed.model.nodes.some((node) => node.id === nodeId)) {
    return null;
  }
  const lines = lineSpans(source);
  const out: string[] = [];
  for (const line of lines) {
    const original = source.slice(line.from, line.to);
    if (COMMENT_OR_BLANK_RE.test(line.content) || HEADER_RE.test(line.content)) {
      out.push(original);
      continue;
    }
    const edgeParsed = parseEdgeStatement(
      line.content,
      0,
      { from: 0, to: line.content.length },
      0,
    );
    if (edgeParsed && "edge" in edgeParsed) {
      if (
        edgeParsed.edge.start === nodeId ||
        edgeParsed.edge.end === nodeId
      ) {
        const indent = line.content.match(/^[ \t]*/)?.[0] ?? "";
        const nl = lineEndingOf(original);
        for (const token of [edgeParsed.start, edgeParsed.end]) {
          if (
            token.id !== nodeId &&
            token.text != null &&
            token.shape &&
            token.defSpan
          ) {
            out.push(
              `${indent}${nodeDefText(token.id, token.text, token.shape, token.quoted)}${nl}`,
            );
          }
        }
        continue;
      }
      out.push(original);
      continue;
    }
    const nodeParsed = parseNodeOnlyStatement(line.content, 0);
    if (nodeParsed && !("error" in nodeParsed) && nodeParsed.id === nodeId) {
      continue;
    }
    out.push(original);
  }
  return joinLines(source, out);
}

export function deleteFlowEdge(source: string, edgeId: string): string | null {
  const parsed = parseFlowchartSource(source);
  if (!parsed.ok) {
    return null;
  }
  const edge = parsed.model.edges.find((item) => item.id === edgeId);
  if (!edge) {
    return null;
  }
  const lines = lineSpans(source);
  const out: string[] = [];
  let removed = false;
  for (const line of lines) {
    const original = source.slice(line.from, line.to);
    if (
      !removed &&
      line.from === edge.statementSpan.from &&
      line.to === edge.statementSpan.to
    ) {
      removed = true;
      const edgeParsed = parseEdgeStatement(
        line.content,
        0,
        { from: 0, to: line.content.length },
        0,
      );
      const indent = line.content.match(/^[ \t]*/)?.[0] ?? "";
      const nl = lineEndingOf(original);
      if (edgeParsed && "edge" in edgeParsed) {
        for (const token of [edgeParsed.start, edgeParsed.end]) {
          if (!(token.text != null && token.shape && token.defSpan)) {
            continue;
          }
          const definedElsewhere = parsed.model.nodes.some(
            (node) =>
              node.id === token.id &&
              node.defSpan &&
              !(
                node.defSpan.from >= edge.statementSpan.from &&
                node.defSpan.to <= edge.statementSpan.to
              ),
          );
          if (!definedElsewhere) {
            out.push(
              `${indent}${nodeDefText(token.id, token.text, token.shape, token.quoted)}${nl}`,
            );
          }
        }
      }
      continue;
    }
    out.push(original);
  }
  if (!removed) {
    return null;
  }
  return joinLines(source, out);
}

/**
 * Resolve Mermaid fence body offsets inside full Markdown fence span.
 */
export function resolveMermaidFenceBodyRange(
  source: string,
  fenceFrom: number,
  fenceTo: number,
  body: string,
): SourceSpan | null {
  if (
    fenceFrom < 0 ||
    fenceTo > source.length ||
    fenceTo < fenceFrom ||
    typeof body !== "string"
  ) {
    return null;
  }
  const fence = source.slice(fenceFrom, fenceTo);
  const openMatch = /^```[^\n\r]*\r?\n/.exec(fence);
  if (!openMatch) {
    return null;
  }
  const bodyFrom = fenceFrom + openMatch[0].length;
  if (source.slice(bodyFrom, bodyFrom + body.length) !== body) {
    return null;
  }
  return { from: bodyFrom, to: bodyFrom + body.length };
}

export function findFlowNodeByDomId(
  model: FlowchartSourceModel,
  domId: string,
): FlowNodeDef | null {
  const match = /(?:^|-)flowchart-(.+)-(\d+)$/.exec(domId);
  if (!match) {
    return null;
  }
  const raw = match[1]!;
  return model.nodes.find((node) => node.id === raw) ?? null;
}

export function findFlowEdgeByDataId(
  model: FlowchartSourceModel,
  dataId: string,
): FlowEdgeDef | null {
  const match = /^L_(.+)_(\d+)$/.exec(dataId);
  if (!match) {
    return null;
  }
  const rest = match[1]!;
  const ids = [...model.nodes.map((node) => node.id)].sort(
    (a, b) => b.length - a.length,
  );
  for (const start of ids) {
    if (!rest.startsWith(`${start}_`)) {
      continue;
    }
    const endPart = rest.slice(start.length + 1);
    if (ids.includes(endPart)) {
      return (
        model.edges.find(
          (edge) => edge.start === start && edge.end === endPart,
        ) ?? null
      );
    }
  }
  return null;
}
