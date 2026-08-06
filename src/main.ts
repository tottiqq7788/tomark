import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import "./preview/markdownBody.css";

if (import.meta.env.VITE_WDIO === "1") {
  void import("@wdio/tauri-plugin");
}

createApp(App).mount("#app");
