import { describe, expect, it, vi, beforeEach } from "vitest";
import { defaultDocumentFormat, utf8DocumentFormat } from "@/shared/types";
import { UnmappableCharacterError } from "@/shared/encodingErrors";

const { invoke, open, save, message } = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, save, message }));

import {
  detectFormat,
  loadMarkdownFile,
  saveMarkdownFile,
  saveMarkdownFileAs,
  serializeContent,
} from "@/native/fileService";

describe("fileService native text compatibility", () => {
  beforeEach(() => {
    invoke.mockReset();
    open.mockReset();
    save.mockReset();
    message.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("loads markdown through the native document command", async () => {
    invoke.mockResolvedValue({
      path: "/tmp/note.md",
      content: "hello\n",
      format: utf8DocumentFormat("crlf", true),
    });
    await expect(loadMarkdownFile("/tmp/note.md")).resolves.toEqual({
      path: "/tmp/note.md",
      fileName: "note.md",
      content: "hello\n",
      format: utf8DocumentFormat("crlf", true),
    });
    expect(invoke).toHaveBeenCalledWith("load_markdown_document", {
      path: "/tmp/note.md",
      hint: "auto",
    });
  });

  it("passes reidentify hints to the native loader", async () => {
    invoke.mockResolvedValue({
      path: "/tmp/note.md",
      content: "café\n",
      format: {
        ...defaultDocumentFormat(),
        encoding: "windows1252",
        source: "userHint",
      },
    });
    await loadMarkdownFile("/tmp/note.md", "western");
    expect(invoke).toHaveBeenCalledWith("load_markdown_document", {
      path: "/tmp/note.md",
      hint: "western",
    });
  });

  it("saves through the native document command with format metadata", async () => {
    await saveMarkdownFile("/tmp/note.md", "hello\n", defaultDocumentFormat());
    expect(invoke).toHaveBeenCalledWith("save_markdown_document", {
      request: {
        path: "/tmp/note.md",
        content: "hello\n",
        format: defaultDocumentFormat(),
        forceUtf8: false,
      },
    });
  });

  it("maps unmappable character errors from native save", async () => {
    invoke.mockRejectedValue({
      kind: "unmappableCharacter",
      message: "character U+1F600 cannot be encoded",
      encoding: "windows1252",
      codepoint: 0x1f600,
      index: 6,
    });
    await expect(
      saveMarkdownFile("/tmp/note.md", "hello 😀\n", {
        ...defaultDocumentFormat(),
        encoding: "windows1252",
      }),
    ).rejects.toBeInstanceOf(UnmappableCharacterError);
  });

  it("save-as can force utf-8", async () => {
    save.mockResolvedValue("/tmp/note.md");
    await saveMarkdownFileAs("a\nb\n", utf8DocumentFormat("crlf", true), null, {
      forceUtf8: true,
    });
    expect(invoke).toHaveBeenCalledWith("save_markdown_document", {
      request: {
        path: "/tmp/note.md",
        content: "a\nb\n",
        format: utf8DocumentFormat("crlf", false),
        forceUtf8: true,
      },
    });
  });

  it("still detects bom/crlf for in-memory helpers", () => {
    const { content, format } = detectFormat("\uFEFFhello\r\nworld\r\n");
    expect(content).toBe("hello\nworld\n");
    expect(format).toEqual(utf8DocumentFormat("crlf", true));
    expect(serializeContent(content, format)).toBe("\uFEFFhello\r\nworld\r\n");
  });
});
