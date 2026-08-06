import { invoke } from "@tauri-apps/api/core";
import { open, save, message } from "@tauri-apps/plugin-dialog";
import type {
  DocumentFormat,
  EncodingHint,
  LineEnding,
  LoadedDocument,
  TextEncodingId,
} from "@/shared/types";
import { UNTITLED_NAME, defaultDocumentFormat, utf8DocumentFormat } from "@/shared/types";
import { UnmappableCharacterError } from "@/shared/encodingErrors";

export {
  UnmappableCharacterError,
  isUnmappableCharacterError,
} from "@/shared/encodingErrors";

const FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown"],
  },
];

type NativeLoadedDocument = {
  path: string;
  content: string;
  format: DocumentFormat;
};

type SaveDocumentRequest = {
  path: string;
  content: string;
  format: DocumentFormat;
  forceUtf8?: boolean;
};

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || UNTITLED_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapInvokeError(error: unknown): Error {
  const payload = isRecord(error)
    ? error
    : typeof error === "string"
      ? (() => {
          try {
            return JSON.parse(error) as unknown;
          } catch {
            return null;
          }
        })()
      : null;

  if (isRecord(payload) && payload.kind === "unmappableCharacter") {
    return new UnmappableCharacterError(
      typeof payload.message === "string"
        ? payload.message
        : "当前文件格式无法保存这些字符",
      {
        encoding:
          typeof payload.encoding === "string"
            ? (payload.encoding as TextEncodingId)
            : undefined,
        codepoint:
          typeof payload.codepoint === "number" ? payload.codepoint : undefined,
        index: typeof payload.index === "number" ? payload.index : undefined,
      },
    );
  }

  if (isRecord(payload) && typeof payload.message === "string") {
    return new Error(payload.message);
  }

  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/** Browser/test helper: normalize in-memory UTF-8 text and format metadata. */
export function detectFormat(raw: string): {
  content: string;
  format: DocumentFormat;
} {
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const withoutBom = hasBom ? raw.slice(1) : raw;
  const lineEnding: LineEnding = withoutBom.includes("\r\n") ? "crlf" : "lf";
  const content = withoutBom.replace(/\r\n?/g, "\n");
  return {
    content,
    format: utf8DocumentFormat(lineEnding, hasBom),
  };
}

/** Browser/test helper for UTF-8 serialization only. */
export function serializeContent(content: string, format: DocumentFormat): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withEnding =
    format.lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
  return format.hasBom ? `\uFEFF${withEnding}` : withEnding;
}

export async function loadMarkdownFile(
  path: string,
  hint: EncodingHint = "auto",
): Promise<LoadedDocument> {
  try {
    const doc = await invoke<NativeLoadedDocument>("load_markdown_document", {
      path,
      hint,
    });
    return {
      path: doc.path,
      fileName: fileNameFromPath(doc.path),
      content: doc.content,
      format: doc.format,
    };
  } catch (error) {
    throw mapInvokeError(error);
  }
}

export async function openMarkdownFile(
  hint: EncodingHint = "auto",
): Promise<LoadedDocument | null> {
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
  return loadMarkdownFile(path, hint);
}

export async function saveMarkdownFile(
  path: string,
  content: string,
  format: DocumentFormat,
  options?: { forceUtf8?: boolean },
): Promise<void> {
  const request: SaveDocumentRequest = {
    path,
    content,
    format,
    forceUtf8: options?.forceUtf8 ?? false,
  };
  try {
    await invoke("save_markdown_document", { request });
  } catch (error) {
    throw mapInvokeError(error);
  }
}

export async function saveMarkdownFileAs(
  content: string,
  format: DocumentFormat,
  defaultPath?: string | null,
  options?: { forceUtf8?: boolean },
): Promise<LoadedDocument | null> {
  const path = await save({
    filters: FILTERS,
    defaultPath: defaultPath ?? UNTITLED_NAME,
  });
  if (!path) {
    return null;
  }
  const nextFormat = options?.forceUtf8
    ? utf8DocumentFormat(format.lineEnding, false)
    : format;
  await saveMarkdownFile(path, content, nextFormat, {
    forceUtf8: options?.forceUtf8,
  });
  return {
    path,
    fileName: fileNameFromPath(path),
    content,
    format: nextFormat,
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
    format: defaultDocumentFormat(),
  };
}
