import { defineConfig, type Plugin } from "vite";
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

/** Dev-only: POST /__tomark/force-export triggers export inside the Tauri webview. */
function tomarkForceExportPlugin(): Plugin {
  return {
    name: "tomark-force-export",
    configureServer(server) {
      type Pending = {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      };
      let pending: Pending | null = null;

      const hot = server.hot;
      hot.on("tomark:force-export-result", (data: unknown) => {
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        const current = pending;
        pending = null;
        current.resolve(data);
      });

      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/__tomark/force-export") {
          next();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", () => {
          void (async () => {
            try {
              const job = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
              if (pending) {
                clearTimeout(pending.timer);
                pending.reject(new Error("superseded by a newer force-export request"));
                pending = null;
              }
              const result = await new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => {
                  pending = null;
                  reject(new Error("force-export timed out after 180s"));
                }, 180_000);
                pending = { resolve, reject, timer };
                hot.send("tomark:force-export", job);
              });
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(result));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
            }
          })();
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: srcDir,
  // Browser E2E may run beside tauri:dev on another port. Sharing optimizer
  // output lets one server replace hashes still referenced by the other.
  cacheDir: fileURLToPath(
    new URL(
      `../deps/.vite-cache/${
        command === "build"
          ? "build"
          : process.env.VITE_WDIO === "1"
            ? "wdio"
            : "app"
      }`,
      import.meta.url,
    ),
  ),
  plugins: [vue(), ...(command === "serve" ? [tomarkForceExportPlugin()] : [])],
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  optimizeDeps: {
    // Lazy export renderer. Prebundle a stable URL at startup so WebKit does
    // not keep a transient optimizer URL after the dependency cache commits.
    include: ["html2canvas"],
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
        `connect-src ${connectSrc} https: http:`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: http: data: blob:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
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
    chunkSizeWarningLimit: 1200,
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
            {
              name: "html2canvas",
              test: /node_modules[\\/]html2canvas[\\/]/,
              priority: 8,
            },
          ],
        },
      },
    },
  },
}));
