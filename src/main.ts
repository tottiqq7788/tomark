import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import "./preview/markdownBody.css";

// Some export deps (e.g. html-to-docx / jszip) still reference Node's `global`.
const root = globalThis as typeof globalThis & { global?: typeof globalThis };
if (root.global === undefined) {
  root.global = root;
}

if (import.meta.env.VITE_WDIO === "1") {
  void import("@wdio/tauri-plugin");
}

createApp(App).mount("#app");
