import { ExportCancelledError } from "@/export/types";
import { assertTauriIpcReady, invokeTauri } from "@/native/tauriRuntime";

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function mapInvokeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error(String(error));
}

/**
 * Encode binary for Tauri JSON IPC. Do not pass Uint8Array / number[] for
 * multi‑MB PDFs — WKWebView freezes building or serializing huge arrays.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(
      null,
      chunk as unknown as number[],
    );
  }
  return btoa(binary);
}

export async function pickExportPath(options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  assertTauriIpcReady("导出");
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  if (path == null || path.trim() === "") {
    return null;
  }
  return path;
}

export async function writeExportBytes(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await invokeTauri("atomic_write_bytes_file", {
      path,
      contentsBase64: bytesToBase64(bytes),
    });
  } catch (error) {
    throw mapInvokeError(error);
  }
}

export async function writeExportText(path: string, contents: string): Promise<void> {
  const encoder = new TextEncoder();
  await writeExportBytes(path, encoder.encode(contents));
}

export async function writeHtmlAssetBundle(options: {
  htmlPath: string;
  htmlContent: string;
  assetsDirName: string;
  assets: { relativePath: string; bytes: Uint8Array }[];
}): Promise<void> {
  try {
    await invokeTauri("write_html_export_bundle", {
      htmlPath: options.htmlPath,
      htmlContent: options.htmlContent,
      assetsDirName: options.assetsDirName,
      assets: options.assets.map((asset) => ({
        relativePath: asset.relativePath,
        contentsBase64: bytesToBase64(asset.bytes),
      })),
    });
  } catch (error) {
    throw mapInvokeError(error);
  }
}

export async function saveBytesWithDialog(options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
  bytes: Uint8Array;
}): Promise<{ path: string; fileName: string }> {
  const path = await pickExportPath({
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  if (!path) {
    throw new ExportCancelledError();
  }
  await writeExportBytes(path, options.bytes);
  return { path, fileName: fileNameFromPath(path) };
}

export async function saveTextWithDialog(options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
  contents: string;
}): Promise<{ path: string; fileName: string }> {
  const encoder = new TextEncoder();
  return saveBytesWithDialog({
    defaultPath: options.defaultPath,
    filters: options.filters,
    bytes: encoder.encode(options.contents),
  });
}
