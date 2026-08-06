import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedDocument } from "@/shared/types";

const nativeMocks = vi.hoisted(() => ({
  openMarkdownFile: vi.fn(),
  loadMarkdownFile: vi.fn(),
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

import { useDocumentSession, AUTOSAVE_WAIT_MS } from "@/app/useDocumentSession";

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
    nativeMocks.loadMarkdownFile.mockReset();
    nativeMocks.saveMarkdownFile.mockReset();
    nativeMocks.saveMarkdownFileAs.mockReset();
    nativeMocks.showError.mockReset();
    nativeMocks.showError.mockResolvedValue(undefined);
    vi.useRealTimers();
  });

  it("marks pristine untitled content as not persisted", () => {
    const session = useDocumentSession();

    expect(session.dirty.value).toBe(false);
    expect(session.path.value).toBeNull();
    expect(session.saveStatus.value).toBe("unsaved");
    session.dispose();
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
    session.dispose();
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
    session.dispose();
  });

  it("reuses one dirty guard instead of orphaning the first caller", async () => {
    const session = useDocumentSession();
    session.setContent("dirty");

    const first = session.guardDirty();
    const second = session.guardDirty();

    expect(first).toBe(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.dirtyDialogOpen.value).toBe(true);
    session.onDirtyDiscard();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    session.dispose();
  });

  it("flushes autosave before allowing navigation away from a saved file", async () => {
    nativeMocks.saveMarkdownFile.mockResolvedValue(undefined);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("pending autosave");

    await expect(session.guardDirty()).resolves.toBe(true);
    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledWith(
      "/tmp/example.md",
      "pending autosave",
      { lineEnding: "lf", hasBom: false },
    );
    expect(session.dirty.value).toBe(false);
    expect(session.dirtyDialogOpen.value).toBe(false);
    session.dispose();
  });

  it("auto-saves edits for documents that already have a path", async () => {
    vi.useFakeTimers();
    nativeMocks.saveMarkdownFile.mockResolvedValue(undefined);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("auto saved body");
    expect(session.saveStatus.value).toBe("pending");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledWith(
      "/tmp/example.md",
      "auto saved body",
      { lineEnding: "lf", hasBom: false },
    );
    expect(session.dirty.value).toBe(false);
    expect(session.saveStatus.value).toBe("saved");
    expect(session.statusMessage.value).toContain("已自动保存");
    session.dispose();
    vi.useRealTimers();
  });

  it("defers autosave until editing has been idle for a few seconds", async () => {
    vi.useFakeTimers();
    nativeMocks.saveMarkdownFile.mockResolvedValue(undefined);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";

    session.setContent("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS - 200);
    session.setContent("ab");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS - 200);
    expect(nativeMocks.saveMarkdownFile).not.toHaveBeenCalled();

    session.setContent("abc");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledTimes(1);
    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledWith(
      "/tmp/example.md",
      "abc",
      { lineEnding: "lf", hasBom: false },
    );
    session.dispose();
    vi.useRealTimers();
  });

  it("reschedules autosave when edits arrive during an in-flight write", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred<void>();
    nativeMocks.saveMarkdownFile
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("first");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    await Promise.resolve();
    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledTimes(1);

    session.setContent("second");
    firstWrite.resolve();
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledTimes(2);
    expect(nativeMocks.saveMarkdownFile).toHaveBeenLastCalledWith(
      "/tmp/example.md",
      "second",
      { lineEnding: "lf", hasBom: false },
    );
    expect(session.dirty.value).toBe(false);
    session.dispose();
    vi.useRealTimers();
  });

  it("restores autosave after save-as is cancelled", async () => {
    vi.useFakeTimers();
    nativeMocks.saveMarkdownFileAs.mockResolvedValue(null);
    nativeMocks.saveMarkdownFile.mockResolvedValue(undefined);
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("keep me");

    await expect(session.saveAs()).resolves.toBe(false);
    expect(session.dirty.value).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(nativeMocks.saveMarkdownFile).toHaveBeenCalledWith(
      "/tmp/example.md",
      "keep me",
      { lineEnding: "lf", hasBom: false },
    );
    session.dispose();
    vi.useRealTimers();
  });

  it("stops autosave retries after repeated failures", async () => {
    vi.useFakeTimers();
    nativeMocks.saveMarkdownFile.mockRejectedValue(new Error("disk full"));
    const session = useDocumentSession();
    session.path.value = "/tmp/example.md";
    session.fileName.value = "example.md";
    session.setContent("cannot persist");

    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(nativeMocks.saveMarkdownFile.mock.calls.length).toBeLessThanOrEqual(3);
    expect(nativeMocks.showError).toHaveBeenCalledTimes(1);
    expect(session.statusMessage.value).toContain("已暂停");
    expect(session.saveStatus.value).toBe("unsaved");
    session.dispose();
    vi.useRealTimers();
  });

  it("does not auto-save untitled documents without prompting", async () => {
    vi.useFakeTimers();
    const session = useDocumentSession();
    session.setContent("untitled edits");
    expect(session.saveStatus.value).toBe("unsaved");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS + 500);
    expect(nativeMocks.saveMarkdownFile).not.toHaveBeenCalled();
    expect(nativeMocks.saveMarkdownFileAs).not.toHaveBeenCalled();
    expect(session.dirty.value).toBe(true);
    expect(session.saveStatus.value).toBe("unsaved");
    session.dispose();
    vi.useRealTimers();
  });

  it("opens a document from an external path", async () => {
    nativeMocks.loadMarkdownFile.mockResolvedValue({
      path: "/tmp/external.md",
      fileName: "external.md",
      content: "# Hello",
      format: { lineEnding: "lf", hasBom: false },
    });
    const session = useDocumentSession();
    await expect(session.openDocumentAtPath("/tmp/external.md")).resolves.toBe(
      true,
    );
    expect(session.path.value).toBe("/tmp/external.md");
    expect(session.content.value).toBe("# Hello");
    expect(session.dirty.value).toBe(false);
    session.dispose();
  });

  it("keeps the current document when dirty open is cancelled", async () => {
    const session = useDocumentSession();
    session.setContent("dirty body");
    const opening = session.openDocumentAtPath("/tmp/external.md");
    await Promise.resolve();
    await Promise.resolve();
    expect(session.dirtyDialogOpen.value).toBe(true);
    session.onDirtyCancel();
    await expect(opening).resolves.toBe(false);
    expect(nativeMocks.loadMarkdownFile).not.toHaveBeenCalled();
    expect(session.content.value).toBe("dirty body");
    session.dispose();
  });

  it("no-ops when reopening the same clean path", async () => {
    nativeMocks.loadMarkdownFile.mockResolvedValue({
      path: "/tmp/same.md",
      fileName: "same.md",
      content: "body",
      format: { lineEnding: "lf", hasBom: false },
    });
    const session = useDocumentSession();
    await expect(session.openDocumentAtPath("/tmp/same.md")).resolves.toBe(true);
    nativeMocks.loadMarkdownFile.mockClear();
    await expect(session.openDocumentAtPath("/tmp/same.md")).resolves.toBe(true);
    expect(nativeMocks.loadMarkdownFile).not.toHaveBeenCalled();
    session.dispose();
  });
});

