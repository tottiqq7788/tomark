import { createApp } from "vue";
import App from "./App.vue";
// ProseMirror selection/caret coordinate mapping depends on these layout
// invariants (break-spaces, no ligatures, separator images). Load before
// product preview styles so overrides stay intentional and local.
import "prosemirror-view/style/prosemirror.css";
import "./styles.css";
import "./preview/markdownBody.css";

if (import.meta.env.VITE_WDIO === "1") {
  void import("@wdio/tauri-plugin");
}

createApp(App).mount("#app");
