/**
 * Locate a text glyph range inside the editable preview and return viewport
 * coordinates plus offsets relative to the ProseMirror root.
 */
export async function locatePreviewTextRect(
  needle: string,
): Promise<{
  ok: boolean;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  midY?: number;
  relLeft?: number;
  relRight?: number;
  relMidY?: number;
  reason?: string;
}> {
  return browser.execute((text: string) => {
    const root = document.querySelector(".tm-editable-preview");
    if (!(root instanceof HTMLElement)) {
      return { ok: false, reason: "no-root" };
    }
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const content = node.textContent ?? "";
      const index = content.indexOf(text);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const anchor =
            node.parentElement instanceof HTMLElement
              ? node.parentElement
              : root;
          anchor.scrollIntoView({ block: "center", inline: "nearest" });
          const refreshed = range.getBoundingClientRect();
          const rootNow = root.getBoundingClientRect();
          return {
            ok: true,
            left: refreshed.left,
            right: refreshed.right,
            top: refreshed.top,
            bottom: refreshed.bottom,
            midY: refreshed.top + Math.max(1, refreshed.height / 2),
            relLeft: refreshed.left - rootNow.left,
            relRight: refreshed.right - rootNow.left,
            relMidY:
              refreshed.top -
              rootNow.top +
              Math.max(1, refreshed.height / 2),
          };
        }
      }
      node = walker.nextNode();
    }
    return { ok: false, reason: "missing-needle" };
  }, needle);
}

async function pointerDragAbsolute(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: Math.round(startX), y: Math.round(startY), duration: 0 })
    .down()
    .up()
    .perform();

  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: Math.round(startX), y: Math.round(startY), duration: 0 })
    .down()
    .pause(40)
    .move({ x: Math.round(endX), y: Math.round(endY), duration: 240 })
    .pause(40)
    .up()
    .perform();

  await browser.pause(80);
}

/**
 * Fallback when WebDriver pointer drag cannot establish a text selection
 * (common under some WKWebView drivers). Still uses the real DOM Range for the
 * needle and fires mouseup so the edit session publishes a settled snapshot.
 */
async function selectPreviewTextViaDomRange(needle: string): Promise<void> {
  const ok = await browser.execute((text: string) => {
    const root = document.querySelector(".tm-editable-preview");
    if (!(root instanceof HTMLElement)) {
      return false;
    }
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const content = node.textContent ?? "";
      const index = content.indexOf(text);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        root.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
        return selection?.toString() === text;
      }
      node = walker.nextNode();
    }
    return false;
  }, needle);
  if (!ok) {
    throw new Error(`DOM range fallback failed for "${needle}"`);
  }
  await browser.pause(100);
}

export async function readSelectionConsistency(expected: string): Promise<{
  nativeText: string | null;
  expectedText: string | null;
  sourceSlice: string | null;
  matches: boolean;
}> {
  return browser.execute((needle: string) => {
    const nativeText = window.getSelection()?.toString() ?? null;
    const snapshot = (
      window as unknown as {
        __tomarkE2e?: {
          getPreviewFormatSelection?: () => {
            expectedText?: string;
            from: number;
            to: number;
          } | null;
          getContent?: () => string;
        };
      }
    ).__tomarkE2e;
    const format = snapshot?.getPreviewFormatSelection?.() ?? null;
    const expectedText = format?.expectedText ?? null;
    const source = snapshot?.getContent?.() ?? "";
    const sourceSlice =
      format != null ? source.slice(format.from, format.to) : null;
    const matches =
      nativeText === needle &&
      expectedText === needle &&
      sourceSlice === needle;
    return { nativeText, expectedText, sourceSlice, matches };
  }, expected);
}

/** Real WebDriver pointer drag across a preview text range. */
export async function dragSelectPreviewText(
  needle: string,
  options?: { reverse?: boolean; allowDomFallback?: boolean },
): Promise<void> {
  const rect = await locatePreviewTextRect(needle);
  if (!rect.ok || rect.left == null || rect.right == null || rect.midY == null) {
    throw new Error(`unable to locate preview text "${needle}": ${rect.reason}`);
  }
  const inset = Math.min(3, Math.max(1, (rect.right - rect.left) / 6));
  const startX = options?.reverse ? rect.right - inset : rect.left + inset;
  const endX = options?.reverse ? rect.left + inset : rect.right - inset;
  const y = rect.midY;

  await pointerDragAbsolute(startX, y, endX, y);
  if ((await readSelectionConsistency(needle)).matches) {
    return;
  }

  if (options?.allowDomFallback === false) {
    return;
  }

  // WKWebView automation often cannot synthesize text-selection drags.
  await selectPreviewTextViaDomRange(needle);
}

/** Drag from the trailing blank of a line leftward into `needle`. */
export async function dragFromTrailingBlankInto(
  needle: string,
): Promise<void> {
  const rect = await locatePreviewTextRect(needle);
  if (!rect.ok || rect.left == null || rect.right == null || rect.midY == null) {
    throw new Error(`unable to locate preview text "${needle}": ${rect.reason}`);
  }
  await pointerDragAbsolute(rect.right + 28, rect.midY, rect.left + 2, rect.midY);
}

/** Click the trailing blank to the right of `needle` with a real pointer. */
export async function clickTrailingBlankAfter(
  needle: string,
): Promise<void> {
  const rect = await locatePreviewTextRect(needle);
  if (!rect.ok || rect.right == null || rect.midY == null) {
    throw new Error(`unable to locate preview text "${needle}": ${rect.reason}`);
  }
  const x = Math.round(rect.right + 24);
  const y = Math.round(rect.midY);
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x, y, duration: 0 })
    .down()
    .up()
    .perform();
  await browser.pause(50);
}

export interface PreviewCaretProbe {
  readonly blockId: string;
  readonly caretIndex: number;
  readonly blockTextLength: number;
  readonly collapsed: boolean;
}

export interface PreviewBlockLayout {
  readonly blockId: string;
  readonly text: string;
  readonly textLength: number;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly lines: readonly {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly start: number;
    readonly end: number;
  }[];
}

/** Click viewport whitespace, optionally moving past ProseMirror's 4px cutoff. */
export async function clickBlankAt(
  x: number,
  y: number,
  options?: { jitter?: number },
): Promise<void> {
  const jitter = Math.max(0, options?.jitter ?? 0);
  const action = browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: Math.round(x), y: Math.round(y), duration: 0 })
    .down()
    .pause(30);
  if (jitter > 0) {
    action.move({
      x: Math.round(x + jitter),
      y: Math.round(y),
      duration: 80,
    });
  }
  await action.pause(30).up().perform();
  await browser.pause(80);
}

/** Read the collapsed native caret relative to its source-backed block. */
export async function readCaretProbe(): Promise<PreviewCaretProbe | null> {
  return browser.execute(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.anchorNode) {
      return null;
    }
    const anchorElement =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode.parentElement;
    const block = anchorElement?.closest<HTMLElement>(
      "[data-tm-source-block]",
    );
    if (!block) {
      return null;
    }
    const before = document.createRange();
    before.selectNodeContents(block);
    try {
      before.setEnd(selection.anchorNode, selection.anchorOffset);
    } catch {
      return null;
    }
    return {
      blockId: block.dataset.tmSourceBlock ?? "",
      caretIndex: before.toString().length,
      blockTextLength: block.textContent?.length ?? 0,
      collapsed: selection.isCollapsed,
    };
  });
}

/**
 * Measure visual text lines and their DOM-text offsets for one source block.
 * Per-character ranges make wrapped-line endpoint assertions independent of
 * font metrics and pane width.
 */
export async function readPreviewBlockLayout(
  needle: string,
): Promise<PreviewBlockLayout | null> {
  return browser.execute((text: string) => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tm-source-block]"),
    );
    const block = blocks.find((item) =>
      (item.textContent ?? "").includes(text),
    );
    if (!block) {
      return null;
    }
    const lines: Array<{
      top: number;
      bottom: number;
      left: number;
      right: number;
      start: number;
      end: number;
    }> = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let globalOffset = 0;
    let node = walker.nextNode();
    while (node) {
      const content = node.textContent ?? "";
      for (let offset = 0; offset < content.length; offset += 1) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width <= 0 || rect.height <= 0) {
            continue;
          }
          const existing = lines.find((line) => {
            const overlap =
              Math.min(rect.bottom, line.bottom) -
              Math.max(rect.top, line.top);
            const minimumHeight = Math.min(
              rect.bottom - rect.top,
              line.bottom - line.top,
            );
            return overlap > Math.max(1, minimumHeight * 0.5);
          });
          if (existing) {
            existing.top = Math.min(existing.top, rect.top);
            existing.bottom = Math.max(existing.bottom, rect.bottom);
            existing.left = Math.min(existing.left, rect.left);
            existing.right = Math.max(existing.right, rect.right);
            existing.start = Math.min(existing.start, globalOffset + offset);
            existing.end = Math.max(
              existing.end,
              globalOffset + offset + 1,
            );
          } else {
            lines.push({
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              start: globalOffset + offset,
              end: globalOffset + offset + 1,
            });
          }
        }
      }
      globalOffset += content.length;
      node = walker.nextNode();
    }
    lines.sort((a, b) => a.top - b.top || a.left - b.left);
    const rect = block.getBoundingClientRect();
    const blockText = block.textContent ?? "";
    return {
      blockId: block.dataset.tmSourceBlock ?? "",
      text: blockText,
      textLength: blockText.length,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      lines,
    };
  }, needle);
}

function trailingBlankX(
  block: PreviewBlockLayout,
  line: PreviewBlockLayout["lines"][number],
): number {
  const available = block.right - line.right;
  if (available <= 2) {
    throw new Error(
      `visual line has no clickable trailing blank (${available}px)`,
    );
  }
  return line.right + Math.min(24, Math.max(2, available / 2));
}

async function expectCaret(
  expected: {
    blockId: string;
    caretIndex: number;
    blockTextLength?: number;
  },
  label: string,
): Promise<void> {
  const probe = await readCaretProbe();
  if (
    !probe ||
    !probe.collapsed ||
    probe.blockId !== expected.blockId ||
    probe.caretIndex !== expected.caretIndex ||
    (expected.blockTextLength != null &&
      probe.blockTextLength !== expected.blockTextLength)
  ) {
    throw new Error(
      `${label}: unexpected caret ${JSON.stringify(probe)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

/**
 * Shared Chrome/WKWebView regression flow for wrapped lines, paragraph gaps,
 * task-list atoms, and pointer jitter beyond ProseMirror's 4px click cutoff.
 */
export async function exerciseBlankCaretRegressionScenarios(): Promise<void> {
  const wrapped =
    "这一段故意写得稍长，方便测试预览滚动、Cmd/Ctrl 定位和分隔条拖动后的布局。这里继续补充稳定的回归测试文字，确保较宽窗口中也会形成多个视觉行。";
  const below =
    "第一段：打开一份稍长的文档时，默认会沿第一条标题链展开到正文，其余章节保持折叠。";
  const task = "更多主题与字体设置（示例待办）";
  const source = `${wrapped}\n\n${below}\n\n- [ ] ${task}\n\n### 引用\n`;
  await browser.execute((value: string) => {
    (
      window as unknown as {
        __tomarkE2e: { replaceContent: (next: string) => void };
      }
    ).__tomarkE2e.replaceContent(value);
  }, source);

  let observedLayout: PreviewBlockLayout | null = null;
  try {
    await browser.waitUntil(
      async () => {
        observedLayout = await readPreviewBlockLayout(wrapped.slice(0, 12));
        return !!observedLayout && observedLayout.lines.length >= 2;
      },
      {
        timeout: 15_000,
        timeoutMsg: "wrapped CJK paragraph did not render multiple visual lines",
      },
    );
  } catch {
    throw new Error(
      `wrapped CJK paragraph did not render multiple visual lines: ${JSON.stringify(observedLayout)}`,
    );
  }

  const wrappedLayout = await readPreviewBlockLayout(wrapped.slice(0, 12));
  const belowLayout = await readPreviewBlockLayout(below.slice(0, 12));
  const taskLayout = await readPreviewBlockLayout(task);
  if (
    !wrappedLayout ||
    wrappedLayout.lines.length < 2 ||
    !belowLayout ||
    !taskLayout ||
    taskLayout.lines.length !== 1
  ) {
    throw new Error("unable to measure blank-caret regression fixtures");
  }

  const firstLine = wrappedLayout.lines[0]!;
  await clickBlankAt(
    trailingBlankX(wrappedLayout, firstLine),
    (firstLine.top + firstLine.bottom) / 2,
  );
  await expectCaret(
    {
      blockId: wrappedLayout.blockId,
      caretIndex: firstLine.end,
    },
    "wrapped first-line trailing blank",
  );

  const lastLine = wrappedLayout.lines.at(-1)!;
  await clickBlankAt(
    trailingBlankX(wrappedLayout, lastLine),
    (lastLine.top + lastLine.bottom) / 2,
  );
  await expectCaret(
    {
      blockId: wrappedLayout.blockId,
      caretIndex: wrappedLayout.textLength,
      blockTextLength: wrappedLayout.textLength,
    },
    "wrapped last-line trailing blank",
  );

  const gap = belowLayout.top - wrappedLayout.bottom;
  if (gap <= 2) {
    throw new Error(`paragraph fixture has no measurable margin gap (${gap}px)`);
  }
  await clickBlankAt(
    wrappedLayout.right - 24,
    wrappedLayout.bottom + gap * 0.25,
  );
  await expectCaret(
    {
      blockId: wrappedLayout.blockId,
      caretIndex: wrappedLayout.textLength,
    },
    "upper half of paragraph margin",
  );

  const taskLine = taskLayout.lines[0]!;
  const taskBlankX = trailingBlankX(taskLayout, taskLine);
  const taskLineY = (taskLine.top + taskLine.bottom) / 2;
  await clickBlankAt(taskBlankX, taskLineY);
  await expectCaret(
    {
      blockId: taskLayout.blockId,
      caretIndex: taskLayout.textLength,
      blockTextLength: taskLayout.textLength,
    },
    "task-list trailing blank before jitter",
  );
  await clickBlankAt(
    taskBlankX,
    taskLineY,
    { jitter: 6 },
  );
  await expectCaret(
    {
      blockId: taskLayout.blockId,
      caretIndex: taskLayout.textLength,
      blockTextLength: taskLayout.textLength,
    },
    "jittered task-list trailing blank",
  );
}
