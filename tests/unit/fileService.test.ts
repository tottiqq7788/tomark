import { describe, expect, it, vi, beforeEach } from "vitest";

const { invoke, open, save, readTextFile, message } = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  readTextFile: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, save, message }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile }));

import {
  detectFormat,
  loadMarkdownFile,
  saveMarkdownFile,
  saveMarkdownFileAs,
  serializeContent,
} from "@/native/fileService";

describe("fileService atomic writes", () => {
  beforeEach(() => {
    invoke.mockReset();
    open.mockReset();
    save.mockReset();
    readTextFile.mockReset();
    message.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("loads markdown from an absolute path", async () => {
    readTextFile.mockResolvedValue("\uFEFFhello\r\n");
    await expect(loadMarkdownFile("/tmp/note.md")).resolves.toEqual({
      path: "/tmp/note.md",
      fileName: "note.md",
      content: "hello\n",
      format: { lineEnding: "crlf", hasBom: true },
    });
    expect(readTextFile).toHaveBeenCalledWith("/tmp/note.md");
  });

  it("saves through the atomic write command", async () => {
    await saveMarkdownFile("/tmp/note.md", "hello\n", {
      lineEnding: "lf",
      hasBom: false,
    });
    expect(invoke).toHaveBeenCalledWith("atomic_write_text_file", {
      path: "/tmp/note.md",
      contents: "hello\n",
    });
  });

  it("serializes crlf and bom before atomic save-as", async () => {
    save.mockResolvedValue("/tmp/note.md");
    await saveMarkdownFileAs("a\nb\n", { lineEnding: "crlf", hasBom: true });
    expect(invoke).toHaveBeenCalledWith("atomic_write_text_file", {
      path: "/tmp/note.md",
      contents: "\uFEFFa\r\nb\r\n",
    });
  });

  it("still detects bom/crlf for reads", () => {
    const { content, format } = detectFormat("\uFEFFhello\r\nworld\r\n");
    expect(content).toBe("hello\nworld\n");
    expect(format).toEqual({ lineEnding: "crlf", hasBom: true });
    expect(serializeContent(content, format)).toBe("\uFEFFhello\r\nworld\r\n");
  });
});
