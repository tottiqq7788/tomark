import type { Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appBinary = path.join(
  root,
  "src-tauri/target/debug",
  process.platform === "win32" ? "tomark.exe" : "tomark",
);

export const config: Options.Testrunner = {
  runner: "local",
  specs: [
    "./specs/window-close.spec.ts",
    "./specs/preview-selection-native.spec.ts",
    "./specs/native-export.spec.ts",
  ],
  maxInstances: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: appBinary,
        driverProvider: "embedded",
        embeddedPort: 4445,
        captureBackendLogs: true,
        waitForAppTimeout: 90_000,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinary,
      },
      "wdio:tauriServiceOptions": {
        appBinaryPath: appBinary,
        driverProvider: "embedded",
        embeddedPort: 4445,
        captureBackendLogs: true,
      },
    },
  ],
  logLevel: "warn",
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
};
