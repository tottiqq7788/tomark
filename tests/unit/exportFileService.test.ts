import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe("exportFileService", () => {
  beforeEach(() => {
    save.mockReset();
    invoke.mockReset();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("rejects pickExportPath when IPC is missing (browser tab)", async () => {
    const { pickExportPath } = await import("@/native/exportFileService");
    await expect(
      pickExportPath({
        defaultPath: "a.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      }),
    ).rejects.toThrow(/桌面应用内可用/);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects write when IPC object exists without invoke", async () => {
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
      {};
    const { writeExportBytes } = await import("@/native/exportFileService");
    await expect(writeExportBytes("/tmp/a.bin", new Uint8Array([1]))).rejects.toThrow(
      /桌面应用内可用/,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns null when the user cancels the save dialog", async () => {
    (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ =
      { invoke };
    save.mockResolvedValue(null);
    const { pickExportPath } = await import("@/native/exportFileService");
    await expect(
      pickExportPath({
        defaultPath: "a.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      }),
    ).resolves.toBeNull();
  });

  it("writes bytes after a successful dialog selection", async () => {
    (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ =
      { invoke };
    save.mockResolvedValue("/tmp/out.pdf");
    invoke.mockResolvedValue(null);
    const { saveBytesWithDialog } = await import("@/native/exportFileService");
    const result = await saveBytesWithDialog({
      defaultPath: "out.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    expect(result).toEqual({ path: "/tmp/out.pdf", fileName: "out.pdf" });
    expect(invoke).toHaveBeenCalledWith(
      "atomic_write_bytes_file",
      expect.objectContaining({
        path: "/tmp/out.pdf",
        contentsBase64: btoa("%PDF"),
      }),
    );
  });

  it("maps write failures and cancel through saveBytesWithDialog", async () => {
    (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ =
      { invoke };
    save.mockResolvedValue(null);
    const { saveBytesWithDialog } = await import("@/native/exportFileService");
    await expect(
      saveBytesWithDialog({
        defaultPath: "out.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/已取消导出/);

    save.mockResolvedValue("/tmp/out.pdf");
    invoke.mockRejectedValue("disk full");
    await expect(
      saveBytesWithDialog({
        defaultPath: "out.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow("disk full");
  });
});
