import { mockAppIpc } from "../helpers/tauriMocks";

describe("settings export drawer", () => {
  beforeEach(async () => {
    await browser.url("/");
    await mockAppIpc({
      savePath: "/tmp/tomark-export-e2e.html",
    });
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
  });

  async function openExportPanel() {
    const settings = await $('[data-testid="status-settings"]');
    await settings.waitForExist({ timeout: 10_000 });
    await settings.click();

    const drawer = await $('[data-testid="settings-drawer"]');
    await drawer.waitForDisplayed({ timeout: 10_000 });
  }

  it("opens the settings export drawer and shows html, png and pdf actions", async () => {
    await openExportPanel();

    await expect($('[data-testid="export-settings-panel"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-html-embedded"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-html-assets"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-png"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-pdf"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-pdf-paged"]')).not.toBeDisplayed();
    await expect($('[data-testid="export-action-docx"]')).not.toBeDisplayed();
  });

  it("opens the help settings panel from the footer question mark", async () => {
    const help = await $('[data-testid="status-help"]');
    await help.waitForExist({ timeout: 10_000 });
    await help.click();

    const drawer = await $('[data-testid="settings-drawer"]');
    await drawer.waitForDisplayed({ timeout: 10_000 });
    await expect($('[data-testid="help-settings-panel"]')).toBeDisplayed();
    await expect(
      $('[data-testid="settings-nav-help"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  it("loads every lazy renderer module before exporting", async () => {
    await browser.setTimeout({ script: 30_000 });
    const errorMessage = await browser.executeAsync((done) => {
      const api = (
        window as unknown as {
          __tomarkE2e?: { preloadExportRenderers: () => Promise<void> };
        }
      ).__tomarkE2e;
      if (!api) {
        done("E2E bridge is unavailable");
        return;
      }
      void api.preloadExportRenderers().then(
        () => done(null),
        (error: unknown) =>
          done(error instanceof Error ? error.message : String(error)),
      );
    });
    expect(errorMessage).toBeNull();
  });
});
