import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ExportCancelledError } from "@/export/types";

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

export async function pickExportPath(options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
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
    await invoke("atomic_write_bytes_file", {
      path,
      contents: Array.from(bytes),
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
    await invoke("write_html_export_bundle", {
      htmlPath: options.htmlPath,
      htmlContent: options.htmlContent,
      assetsDirName: options.assetsDirName,
      assets: options.assets.map((asset) => ({
        relativePath: asset.relativePath,
        contents: Array.from(asset.bytes),
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
