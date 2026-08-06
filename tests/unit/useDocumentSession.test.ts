import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedDocument } from "@/shared/types";

const nativeMocks = vi.hoisted(() => ({
  openMarkdownFile: vi.fn(),
  saveMarkdownFile: vi.fn(),
  saveMarkdownFileAs: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/native/fileService", () => ({
  ...nativeMocks,
  createEmptyDocument: () => ({
    path: null,
    fileName: "未命名.md",
    content: "",
    format: { lineEnding: "lf", hasBom: false },
  }),
}));

import { useDocumentSession } from "@/app/useDocumentSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useDocumentSession", () => {
  beforeEach(() => {
    nativeMocks.openMarkdownFile.mockReset();
    nativeMocks.saveMarkdownFile.mockReset();
    nativeMocks.saveMarkdownFileAs.mockReset();
    nativeMocks.showError.mockReset();
    nativeMocks.showError.mockResolvedValue(undefined);
  });

  it("keeps edits made while an existing file is being saved dirty", async () => {
    const write = deferred<void>();
    nativeMocks.saveMarkdownFile.mockReturnValue(write.promise);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("first snapshot");

    const saving = session.save();
    session.setContent("newer edit");
    write.resolve();

    await expect(saving).resolves.toBe(true);
    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledWith(
      "/tmp/example.md",
      "first snapshot",
      { lineEnding: "lf", hasBom: false },
    );
    expect(session.dirty.value).toBe(true);
    expect(session.statusMessage.value).toContain("仍有未保存更改");
  });

  it("keeps edits made during save-as dirty", async () => {
    const write = deferred<LoadedDocument | null>();
    nativeMocks.saveMarkdownFileAs.mockReturnValue(write.promise);
    const session = useDocumentSession();
    session.setContent("first snapshot");

    const saving = session.saveAs();
    session.setContent("newer edit");
    write.resolve({
      path: "/tmp/example.md",
      fileName: "example.md",
      content: "first snapshot",
      format: { lineEnding: "lf", hasBom: false },
    });

    await expect(saving).resolves.toBe(true);
    expect(session.path.value).toBe("/tmp/example.md");
    expect(session.dirty.value).toBe(true);
  });

  it("reuses one dirty guard instead of orphaning the first caller", async () => {
    const session = useDocumentSession();
    session.setContent("dirty");

    const first = session.guardDirty();
    const second = session.guardDirty();

    expect(first).toBe(second);
    expect(session.dirtyDialogOpen.value).toBe(true);
    session.onDirtyDiscard();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("does not resolve a save guard while newer edits remain unsaved", async () => {
    const firstWrite = deferred<void>();
    nativeMocks.saveMarkdownFile
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("first snapshot");

    const guard = session.guardDirty();
    let guardSettled = false;
    void guard.then(() => {
      guardSettled = true;
    });

    const firstSave = session.onDirtySave();
    session.setContent("newer edit");
    firstWrite.resolve();
    await firstSave;

    expect(guardSettled).toBe(false);
    expect(session.dirtyDialogOpen.value).toBe(true);
    expect(session.statusMessage.value).toBe(
      "保存期间内容已更改，请再次保存",
    );

    await session.onDirtySave();
    await expect(guard).resolves.toBe(true);
    expect(session.dirtyDialogOpen.value).toBe(false);
  });
});
