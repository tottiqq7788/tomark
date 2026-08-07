import type { Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depsDir = path.join(root, "deps");
// Linked worktrees often share host port 1420 with another checkout; keep browser
// E2E on 1422 (same as src-tauri/tauri.dev.local) and never reuse a foreign server.
const E2E_PORT = Number(process.env.TOMARK_E2E_PORT || 1422);
const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;

export const config: Options.Testrunner = {
  runner: "local",
  specs: [
    "./specs/shortcuts.spec.ts",
    "./specs/dirty-dialog.spec.ts",
    "./specs/settings-export.spec.ts",
  ],
  maxInstances: 1,
  framework: "mocha",
  reporters: ["spec"],
  baseUrl: E2E_URL,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  services: [
    [
      "@wdio/tauri-service",
      {
        mode: "browser",
        devServerUrl: E2E_URL,
        devServer: {
          command: `npm run dev -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
          cwd: depsDir,
          timeoutMs: 120_000,
          reuseExistingServer: false,
          env: {
            VITE_WDIO: "1",
          },
        },
      },
    ],
  ],
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--disable-gpu", "--window-size=1280,800"],
      },
      "wdio:tauriServiceOptions": {
        mode: "browser",
        devServerUrl: E2E_URL,
      },
    },
  ],
  logLevel: "warn",
};
