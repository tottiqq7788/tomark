export async function mockAppIpc(options?: {
  openPath?: string | null;
  openContent?: string;
  savePath?: string | null;
}) {
  const openPath = options?.openPath ?? null;
  const openContent = options?.openContent ?? "# opened\n";
  const savePath = options?.savePath ?? "/tmp/tomark-e2e.md";

  const openMock = await browser.tauri.mock("plugin:dialog|open");
  await openMock.mockResolvedValue(openPath);

  const saveMock = await browser.tauri.mock("plugin:dialog|save");
  await saveMock.mockResolvedValue(savePath);

  const messageMock = await browser.tauri.mock("plugin:dialog|message");
  await messageMock.mockResolvedValue(null);

  const readMock = await browser.tauri.mock("plugin:fs|read_text_file");
  await readMock.mockResolvedValue(openContent);

  const writeMock = await browser.tauri.mock("save_markdown_document");
  await writeMock.mockResolvedValue(null);

  const saveDocumentMock = await browser.tauri.mock("save_markdown_document");
  await saveDocumentMock.mockResolvedValue(null);

  const writeBytesMock = await browser.tauri.mock("atomic_write_bytes_file");
  await writeBytesMock.mockResolvedValue(null);

  const writeHtmlBundleMock = await browser.tauri.mock("write_html_export_bundle");
  await writeHtmlBundleMock.mockResolvedValue(null);

  const readExportImageMock = await browser.tauri.mock("read_export_image");
  await readExportImageMock.mockResolvedValue({
    bytes: [0x89, 0x50, 0x4e, 0x47],
    mimeType: "image/png",
    extension: "png",
  });

  return {
    openMock,
    saveMock,
    messageMock,
    readMock,
    writeMock,
    saveDocumentMock,
    writeBytesMock,
    writeHtmlBundleMock,
    readExportImageMock,
  };
}
