import { mockAppIpc } from "../helpers/tauriMocks";

describe("dirty confirm dialog", () => {
  beforeEach(async () => {
    await browser.url("http://localhost:1420/");
    await mockAppIpc();
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
  });

  it("opens on Cmd/Ctrl+N after edits and closes with Escape", async () => {
    const editor = await $(".cm-content");
    await editor.waitForExist({ timeout: 30_000 });
    await editor.click();
    await browser.keys(" dirty");

    const isMac = process.platform === "darwin";
    await browser.keys([isMac ? "Meta" : "Control", "n"]);

    const dialog = await $('[data-testid="dirty-dialog"]');
    await dialog.waitForDisplayed();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
  });

  it("discards changes from the dialog", async () => {
    const editor = await $(".cm-content");
    await editor.waitForExist({ timeout: 30_000 });
    await editor.click();
    await browser.keys(" more edits");

    const isMac = process.platform === "darwin";
    await browser.keys([isMac ? "Meta" : "Control", "n"]);
    await $('[data-testid="dirty-discard"]').waitForClickable();
    await $('[data-testid="dirty-discard"]').click();

    await expect($(".toolbar-title")).toHaveText(
      expect.stringContaining("未命名.md"),
    );
    await expect($(".toolbar-title")).not.toHaveText("*");
  });
});
