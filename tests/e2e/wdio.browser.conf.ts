import type { Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depsDir = path.join(root, "deps");

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
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  services: [
    [
      "@wdio/tauri-service",
      {
        mode: "browser",
        devServerUrl: "http://127.0.0.1:1420",
        devServer: {
          command: "npm run dev -- --host 127.0.0.1",
          cwd: depsDir,
          timeoutMs: 120_000,
          reuseExistingServer: true,
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
        devServerUrl: "http://127.0.0.1:1420",
      },
    },
  ],
  logLevel: "warn",
};
