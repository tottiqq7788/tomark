import type { Options } from "@wdio/types";
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appBinary = path.join(root, "src-tauri/target/debug/tomark");
const fixtureDir = path.join(tmpdir(), "tomark-native-paste-e2e");
const fixtureMd = path.join(fixtureDir, "paste-doc.md");

mkdirSync(fixtureDir, { recursive: true });
writeFileSync(fixtureMd, "# paste fixture\n\n", "utf8");

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./specs/editor-paste-image-native.spec.ts"],
  maxInstances: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 180_000,
  },
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: appBinary,
        appArgs: [fixtureMd],
        driverProvider: "embedded",
        waitForAppTimeout: 90_000,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinary,
        args: [fixtureMd],
      },
      "wdio:tauriServiceOptions": {
        appBinaryPath: appBinary,
        appArgs: [fixtureMd],
        driverProvider: "embedded",
      },
    },
  ],
  logLevel: "warn",
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
};

export const nativePasteFixture = {
  dir: fixtureDir,
  mdPath: fixtureMd,
};
