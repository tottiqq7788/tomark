import { invoke } from "@tauri-apps/api/core";
import { open, save, message } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DocumentFormat, LineEnding, LoadedDocument } from "@/shared/types";
import { UNTITLED_NAME } from "@/shared/types";

const FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown"],
  },
];

export function detectFormat(raw: string): { content: string; format: DocumentFormat } {
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const withoutBom = hasBom ? raw.slice(1) : raw;
  const lineEnding: LineEnding = withoutBom.includes("\r\n") ? "crlf" : "lf";
  const content = withoutBom.replace(/\r\n?/g, "\n");
  return {
    content,
    format: { lineEnding, hasBom },
  };
}

export function serializeContent(content: string, format: DocumentFormat): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withEnding =
    format.lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
  return format.hasBom ? `\uFEFF${withEnding}` : withEnding;
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || UNTITLED_NAME;
}

async function atomicWriteTextFile(path: string, contents: string): Promise<void> {
  await invoke("atomic_write_text_file", { path, contents });
}

export async function loadMarkdownFile(path: string): Promise<LoadedDocument> {
  const raw = await readTextFile(path);
  const { content, format } = detectFormat(raw);
  return {
    path,
    fileName: fileNameFromPath(path),
    content,
    format,
  };
}

export async function openMarkdownFile(): Promise<LoadedDocument | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: FILTERS,
  });
  if (selected === null) {
    return null;
  }
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) {
    return null;
  }
  return loadMarkdownFile(path);
}

export async function saveMarkdownFile(
  path: string,
  content: string,
  format: DocumentFormat,
): Promise<void> {
  await atomicWriteTextFile(path, serializeContent(content, format));
}

export async function saveMarkdownFileAs(
  content: string,
  format: DocumentFormat,
  defaultPath?: string | null,
): Promise<LoadedDocument | null> {
  const path = await save({
    filters: FILTERS,
    defaultPath: defaultPath ?? UNTITLED_NAME,
  });
  if (!path) {
    return null;
  }
  await atomicWriteTextFile(path, serializeContent(content, format));
  return {
    path,
    fileName: fileNameFromPath(path),
    content,
    format,
  };
}

export async function showError(title: string, error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  await message(text, { title, kind: "error" });
}

export function createEmptyDocument(): LoadedDocument {
  return {
    path: null,
    fileName: UNTITLED_NAME,
    content: "",
    format: { lineEnding: "lf", hasBom: false },
  };
}
