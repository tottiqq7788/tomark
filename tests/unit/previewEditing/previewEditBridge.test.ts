import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { usePreviewEditBridge } from "@/app/usePreviewEditBridge";
import type { SourcePatchTransaction } from "@/shared/previewEditing";

describe("usePreviewEditBridge", () => {
  it("applies a source transaction and syncs the editable projection", () => {
    const statusMessage = ref("");
    const syncAfterOwnEdit = vi.fn();
    const beginOwnEdit = vi.fn();
    const endOwnEdit = vi.fn();
    const applySourceTransaction = vi.fn(
      (transaction: SourcePatchTransaction) => ({
        ok: true as const,
        revision: 1,
        value: `patched:${transaction.patches[0]?.insert ?? ""}`,
      }),
    );

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
        setComposing: vi.fn(),
        flushEditSession: vi.fn(async () => undefined),
      },
      statusMessage,
    });

    const result = bridge.applySourceTransaction({
      revision: 0,
      origin: "typing",
      patches: [
        { from: 5, to: 5, insert: "!", expectedText: "" },
      ],
      selection: { anchor: 6, head: 6 },
    });

    expect(result.ok).toBe(true);
    expect(applySourceTransaction).toHaveBeenCalledOnce();
    expect(syncAfterOwnEdit).toHaveBeenCalledWith(
      "patched:!",
      { anchor: 6, head: 6 },
      { bumpSync: false },
    );
    expect(beginOwnEdit).toHaveBeenCalled();
    expect(endOwnEdit).toHaveBeenCalled();
  });

  it("bumps sync for structure transactions so the host places the caret", () => {
    const statusMessage = ref("");
    const syncAfterOwnEdit = vi.fn();
    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction: () => ({
          ok: true as const,
          revision: 1,
          value: "A\n\nB\n",
        }),
        getRevision: () => 0,
        getValue: () => "A\nB\n",
        undo: () => false,
        redo: () => false,
      }),
      preview: {
        renderedSource: ref("A\nB\n"),
        isCurrent: () => true,
        syncNow: vi.fn(async () => true),
        syncAfterOwnEdit,
        beginOwnEdit: vi.fn(),
        endOwnEdit: vi.fn(),
        setComposing: vi.fn(),
        flushEditSession: vi.fn(async () => undefined),
      },
      statusMessage,
    });

    bridge.applySourceTransaction({
      revision: 0,
      origin: "structure",
      patches: [{ from: 1, to: 1, insert: "\n\n", expectedText: "" }],
      selection: { anchor: 3, head: 3 },
    });

    expect(syncAfterOwnEdit).toHaveBeenCalledWith(
      "A\n\nB\n",
      { anchor: 3, head: 3 },
      { bumpSync: true },
    );
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
        setComposing: vi.fn(),
        flushEditSession: vi.fn(async () => undefined),
        flushCompositionOnly: vi.fn(),
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
        setComposing: vi.fn(),
        flushEditSession: vi.fn(async () => undefined),
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

  it("forces a resync when the editor rejects a stale transaction", () => {
    const statusMessage = ref("");
    const syncNow = vi.fn(async () => true);
    const bridge = usePreviewEditBridge({
      getEditor: () => ({
        applySourceTransaction: () => ({
          ok: false as const,
          reason: "stale-revision" as const,
          revision: 3,
        }),
        getRevision: () => 3,
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
        setComposing: vi.fn(),
        flushEditSession: vi.fn(async () => undefined),
      },
      statusMessage,
    });

    const result = bridge.applySourceTransaction({
      revision: 0,
      origin: "typing",
      patches: [{ from: 0, to: 1, insert: "h", expectedText: "H" }],
    });

    expect(result.ok).toBe(false);
    expect(syncNow).toHaveBeenCalled();
    expect(statusMessage.value).toContain("映射已过期");
  });
});
