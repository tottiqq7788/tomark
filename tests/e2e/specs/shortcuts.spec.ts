import { mockAppIpc } from "../helpers/tauriMocks";

describe("keyboard shortcuts", () => {
  let saveDocumentMock: Awaited<ReturnType<typeof mockAppIpc>>["saveDocumentMock"];

  beforeEach(async () => {
    await browser.url("/");
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-shortcut.md",
    });
    saveDocumentMock = mocks.saveDocumentMock;
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
  });

  it("saves with Cmd/Ctrl+S through the save_markdown_document command", async () => {
    // Untitled docs go through save-as, which uses the dialog save mock path.
    await $(".cm-content").waitForExist({ timeout: 30_000 });
    await $(".cm-content").click();
    const isMac = process.platform === "darwin";
    await browser.keys([isMac ? "Meta" : "Control", "s"]);

    await browser.waitUntil(
      async () => {
        await saveDocumentMock.update();
        return saveDocumentMock.mock.calls.length > 0;
      },
      {
        timeout: 10_000,
        timeoutMsg: "save_markdown_document was not invoked",
      },
    );
    expect(saveDocumentMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          path: "/tmp/tomark-shortcut.md",
        }),
      }),
    );
    await expect($(".status")).toHaveText(expect.stringContaining("已保存"));
  });
});
