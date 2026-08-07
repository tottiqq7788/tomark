import { tmpdir } from "node:os";
import path from "node:path";
import { mockAppIpc } from "../helpers/tauriMocks";

/**
 * Native export write-path coverage lives in unit tests + browser settings E2E.
 * Full WebView dialog→write IPC here remains fragile under the current WDIO
 * Tauri mock surface (branch originally used a non-existent getHistory API).
 * Keep a UI smoke so the settings entry points stay wired in the native shell.
 */
describe("native export (Tauri WebView)", () => {
  beforeEach(async () => {
    await mockAppIpc({
      savePath: path.join(tmpdir(), "tomark-native-export-out.bin"),
    });
    await $(".toolbar-title").waitForExist({ timeout: 60_000 });
  });

  it("opens settings export actions in the native shell", async () => {
    const settings = await $('[data-testid="status-settings"]');
    await settings.waitForExist({ timeout: 15_000 });
    await settings.click();
    await $('[data-testid="settings-drawer"]').waitForDisplayed({
      timeout: 15_000,
    });
    await $('[data-testid="export-settings-panel"]').waitForDisplayed({
      timeout: 15_000,
    });
    await expect($('[data-testid="export-action-pdf"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-pdf-paged"]')).toBeDisplayed();
    await expect(
      $('[data-testid="export-action-html-embedded"]'),
    ).toBeDisplayed();
    await expect($('[data-testid="export-action-docx"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-png"]')).toBeDisplayed();
  });
});
