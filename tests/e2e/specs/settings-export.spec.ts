import { mockAppIpc } from "../helpers/tauriMocks";

describe("settings export drawer", () => {
  beforeEach(async () => {
    await browser.url("http://localhost:1420/");
    await mockAppIpc({
      savePath: "/tmp/tomark-export-e2e.html",
    });
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
  });

  it("opens settings from the footer gear and shows five export actions", async () => {
    const settings = await $('[data-testid="status-settings"]');
    await settings.waitForExist({ timeout: 10_000 });
    await settings.click();

    const drawer = await $('[data-testid="settings-drawer"]');
    await drawer.waitForDisplayed({ timeout: 10_000 });

    await expect($('[data-testid="export-settings-panel"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-pdf"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-html-embedded"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-html-assets"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-docx"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-png"]')).toBeDisplayed();
  });
});
