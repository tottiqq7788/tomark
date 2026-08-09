import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { usePreviewEditBridge } from "@/app/usePreviewEditBridge";

describe("usePreviewEditBridge", () => {
  it("applies a format selection and syncs the editable projection", async () => {
    const statusMessage = ref("");
    const syncAfterOwnEdit = vi.fn();
    const beginOwnEdit = vi.fn();
    const endOwnEdit = vi.fn();
    const applySourceTransaction = vi.fn(() => ({
      ok: true as const,
      revision: 1,
      value: "Hel**lo**",
    }));

    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction,
        getRevision: () => 0,
        getValue: () => "Hello",
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref("Hello"),
        isCurrent: () => true,
        syncNow: vi.fn(async () => true),
        syncAfterOwnEdit,
        beginOwnEdit,
        endOwnEdit,
      },
      statusMessage,
    });

    await bridge.onFormatSelection({
      action: { type: "toggle", format: "bold" },
      selection: {
        from: 3,
        to: 5,
        expectedText: "lo",
        revision: 0,
        blockAnchorId: "p-0",
        sourceLine: 1,
        active: {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          link: false,
          linkHref: null,
          ranges: {},
        },
        rect: {
          top: 0,
          left: 0,
          bottom: 10,
          right: 20,
          width: 20,
          height: 10,
        },
      },
    });

    expect(applySourceTransaction).toHaveBeenCalledOnce();
    expect(syncAfterOwnEdit).toHaveBeenCalledWith(
      "Hel**lo**",
      expect.objectContaining({
        anchor: expect.any(Number),
        head: expect.any(Number),
      }),
      { bumpSync: true },
    );
    expect(beginOwnEdit).toHaveBeenCalled();
    expect(endOwnEdit).toHaveBeenCalled();
  });

  it("syncs preview selection after undo and redo", () => {
    const statusMessage = ref("");
    const syncNow = vi.fn(async () => true);
    let selection = { anchor: 5, head: 5 };
    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction: () => ({
          ok: true as const,
          revision: 1,
          value: "Hello",
        }),
        getRevision: () => 1,
        getValue: () => "Hello",
        getSelection: () => selection,
        undo: () => {
          selection = { anchor: 4, head: 4 };
          return true;
        },
        redo: () => {
          selection = { anchor: 5, head: 5 };
          return true;
        },
      }),
      preview: {
        renderedSource: ref("Hello"),
        isCurrent: () => true,
        syncNow,
        syncAfterOwnEdit: vi.fn(),
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
      },
      statusMessage,
    });

    expect(bridge.undoEdit()).toBe(true);
    expect(syncNow).toHaveBeenCalledWith({
      selection: { anchor: 4, head: 4 },
    });

    expect(bridge.redoEdit()).toBe(true);
    expect(syncNow).toHaveBeenCalledWith({
      selection: { anchor: 5, head: 5 },
    });
  });

  it("forces syncNow when edit status reports stale", () => {
    const statusMessage = ref("");
    const syncNow = vi.fn(async () => true);
    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction: () => ({
          ok: true as const,
          revision: 1,
          value: "Hello",
        }),
        getRevision: () => 1,
        getValue: () => "Hello",
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref("Hello"),
        isCurrent: () => true,
        syncNow,
        syncAfterOwnEdit: vi.fn(),
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
      },
      statusMessage,
    });

    bridge.onEditStatus({
      kind: "stale",
      message: "映射已过期，已重新同步",
    });
    expect(syncNow).toHaveBeenCalled();
    expect(statusMessage.value).toContain("映射已过期");
  });

  it("toggles a task checkbox through a source patch", () => {
    const statusMessage = ref("");
    const syncAfterOwnEdit = vi.fn();
    const applySourceTransaction = vi.fn(() => ({
      ok: true as const,
      revision: 1,
      value: "- [x] buy milk\n",
    }));
    const source = "- [ ] buy milk\n";

    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction,
        getRevision: () => 0,
        getValue: () => source,
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref(source),
        isCurrent: () => true,
        syncNow: vi.fn(async () => true),
        syncAfterOwnEdit,
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
      },
      statusMessage,
    });

    bridge.onToggleTaskCheckbox({
      from: 2,
      to: 6,
      expectedText: "[ ] ",
      revision: 0,
    });

    expect(applySourceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "task-checkbox",
        revision: 0,
        patches: [
          {
            from: 2,
            to: 6,
            insert: "[x] ",
            expectedText: "[ ] ",
          },
        ],
      }),
    );
    expect(syncAfterOwnEdit).toHaveBeenCalledWith(
      "- [x] buy milk\n",
      null,
      { bumpSync: true },
    );
  });

  it("refuses task checkbox toggle when revision is stale", () => {
    const statusMessage = ref("");
    const syncNow = vi.fn(async () => true);
    const applySourceTransaction = vi.fn();
    const source = "- [ ] buy milk\n";

    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction,
        getRevision: () => 2,
        getValue: () => source,
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref(source),
        isCurrent: () => true,
        syncNow,
        syncAfterOwnEdit: vi.fn(),
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
      },
      statusMessage,
    });

    bridge.onToggleTaskCheckbox({
      from: 2,
      to: 6,
      expectedText: "[ ] ",
      revision: 0,
    });

    expect(applySourceTransaction).not.toHaveBeenCalled();
    expect(syncNow).toHaveBeenCalled();
    expect(statusMessage.value).toContain("预览内容已更新");
  });

  it("refuses task checkbox toggle when expectedText mismatches", () => {
    const statusMessage = ref("");
    const syncNow = vi.fn(async () => true);
    const applySourceTransaction = vi.fn();
    const source = "- [x] buy milk\n";

    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction,
        getRevision: () => 0,
        getValue: () => source,
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref(source),
        isCurrent: () => true,
        syncNow,
        syncAfterOwnEdit: vi.fn(),
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
      },
      statusMessage,
    });

    bridge.onToggleTaskCheckbox({
      from: 2,
      to: 6,
      expectedText: "[ ] ",
      revision: 0,
    });

    expect(applySourceTransaction).not.toHaveBeenCalled();
    expect(syncNow).toHaveBeenCalled();
    expect(statusMessage.value).toContain("任务状态已变化");
  });

  it("refuses format when preview content is stale", async () => {
    const statusMessage = ref("");
    const applySourceTransaction = vi.fn();
    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction,
        getRevision: () => 0,
        getValue: () => "Hello!",
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref("Hello"),
        isCurrent: () => false,
        syncNow: vi.fn(async () => true),
        syncAfterOwnEdit: vi.fn(),
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
      },
      statusMessage,
    });

    await bridge.onFormatSelection({
      action: { type: "toggle", format: "bold" },
      selection: {
        from: 0,
        to: 5,
        expectedText: "Hello",
        revision: 0,
        blockAnchorId: "p-0",
        sourceLine: 1,
        active: {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          link: false,
          linkHref: null,
          ranges: {},
        },
        rect: {
          top: 0,
          left: 0,
          bottom: 10,
          right: 40,
          width: 40,
          height: 10,
        },
      },
    });

    expect(applySourceTransaction).not.toHaveBeenCalled();
    expect(statusMessage.value).toContain("预览内容已更新");
  });
});
