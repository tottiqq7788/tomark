import { mockAppIpc } from "../helpers/tauriMocks";

describe("keyboard shortcuts", () => {
  let writeMock: Awaited<ReturnType<typeof mockAppIpc>>["writeMock"];

  beforeEach(async () => {
    await browser.url("http://localhost:1420/");
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-shortcut.md",
    });
    writeMock = mocks.writeMock;
    await $("button*=另存为").waitForExist({ timeout: 30_000 });
  });

  it("saves with Cmd/Ctrl+S through the atomic write command", async () => {
    // Untitled docs go through save-as, which uses the dialog save mock path.
    const isMac = process.platform === "darwin";
    await browser.keys([isMac ? "Meta" : "Control", "s"]);

    await writeMock.update();
    expect(writeMock.mock.calls.length).toBeGreaterThan(0);
    expect(writeMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        path: "/tmp/tomark-shortcut.md",
      }),
    );
    await expect($(".status")).toHaveText(expect.stringContaining("已保存"));
  });
});
