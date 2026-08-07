import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const srcDir = fileURLToPath(new URL(".", import.meta.url));
const host = process.env.TAURI_DEV_HOST;

const connectSrc = host
  ? [
      "'self'",
      `ws://${host}:1421`,
      `http://${host}:1420`,
      "ipc:",
      "http://ipc.localhost",
      "https://ipc.localhost",
    ].join(" ")
  : [
      "'self'",
      "ws://localhost:1421",
      "http://localhost:1420",
      "ipc:",
      "http://ipc.localhost",
      "https://ipc.localhost",
    ].join(" ");

export default defineConfig({
  root: srcDir,
  cacheDir: fileURLToPath(new URL("../deps/.vite-cache", import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    headers: {
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval'",
        `connect-src ${connectSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: http: data: blob:",
        "font-src 'self' data:",
      ].join("; "),
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    outDir: fileURLToPath(new URL("../deps/dist", import.meta.url)),
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "oxc" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 500,
    // Keep the Vite preload helper out of the huge mermaid async chunk; otherwise
    // PreviewPane/renderMermaid gain a static import of mermaid and load ~3MB early.
    modulePreload: false,
    rolldownOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        codeSplitting: {
          minSize: 20_000,
          groups: [
            {
              name: "vue",
              test: /node_modules[\\/]vue[\\/]/,
              priority: 40,
            },
            {
              name: "codemirror",
              test: /node_modules[\\/](@codemirror|@lezer)[\\/]/,
              priority: 30,
              maxSize: 480_000,
            },
            {
              name: "prosemirror",
              test: /node_modules[\\/](prosemirror-|orderedmap|w3c-keyname|crelt)/,
              priority: 25,
              maxSize: 480_000,
            },
            {
              name: "markdown",
              // Keep unified/remark/rehype in ONE chunk. Splitting with maxSize
              // created circular cross-chunk imports that leave `extend`/`unified`
              // undefined at init (`t is not a function` in WebKit/production).
              test: /node_modules[\\/](unified|remark-|rehype-|mdast-|micromark|hast-|unist-|vfile|bail|trough|devlop|property-information|space-separated-tokens|comma-separated-tokens|html-void-elements|stringify-entities|character-entities|decode-named-character-reference|ccount|longest-streak|zwitch|is-plain-obj|extend)/,
              priority: 20,
            },
            // Intentionally no forced "mermaid" group: a named group made Vite place
            // __vitePreload inside the huge mermaid chunk, so PreviewPane gained a
            // static import of ~3MB. Mermaid 11 already splits diagram types itself.
            {
              name: "tauri",
              test: /node_modules[\\/]@tauri-apps[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
