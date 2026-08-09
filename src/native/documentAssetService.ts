import { bytesToBase64 } from "@/native/exportFileService";
import { assertTauriIpcReady, invokeTauri } from "@/native/tauriRuntime";

function mapInvokeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error(String(error));
}

/** Write image bytes under the document directory as a relative assets/ path. */
export async function writeRelativeImage(
  documentPath: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<string> {
  assertTauriIpcReady("写入图片");
  try {
    return await invokeTauri<string>("write_document_relative_image", {
      documentPath,
      relativePath,
      contentsBase64: bytesToBase64(bytes),
    });
  } catch (error) {
    throw mapInvokeError(error);
  }
}
