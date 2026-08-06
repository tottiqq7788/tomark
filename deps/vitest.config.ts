import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";

const depsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(depsDir, "..");
const srcDir = path.join(projectRoot, "src");

export default defineConfig({
  cacheDir: path.join(depsDir, ".vite-cache"),
  plugins: [vue()],
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.{test,spec}.ts", "src/**/*.{test,spec}.ts"],
  },
});
