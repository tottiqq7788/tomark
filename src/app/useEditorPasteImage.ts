import type { EditorView } from "@codemirror/view";
import { writeRelativeImage } from "@/native/documentAssetService";
import {
  buildMarkdownImageSyntax,
  buildPastedImageRelativePath,
  readFileBytesLimited,
} from "@/editor/pasteImageMarkdown";

export type EditorPasteImageDeps = {
  getDocumentPath: () => string | null;
  ensureDocumentSaved: () => Promise<boolean>;
  showError: (title: string, error: unknown) => Promise<void> | void;
};

export function createEditorPasteImageHandler(deps: EditorPasteImageDeps) {
  let inFlight = false;

  return async function onPasteImage(file: File, view: EditorView): Promise<void> {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      let documentPath = deps.getDocumentPath();
      if (!documentPath) {
        const saved = await deps.ensureDocumentSaved();
        if (!saved) {
          return;
        }
        documentPath = deps.getDocumentPath();
        if (!documentPath) {
          return;
        }
      }

      const bytes = await readFileBytesLimited(file);
      const relativePath = buildPastedImageRelativePath(file.type);
      const writtenPath = await writeRelativeImage(documentPath, relativePath, bytes);
      const markdown = buildMarkdownImageSyntax(writtenPath);
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: markdown },
        selection: { anchor: from + markdown.length },
        userEvent: "input.paste",
      });
      view.focus();
    } catch (error) {
      await deps.showError("粘贴图片失败", error);
    } finally {
      inFlight = false;
    }
  };
}
