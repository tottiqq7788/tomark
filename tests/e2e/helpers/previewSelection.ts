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
