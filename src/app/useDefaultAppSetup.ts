import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

export type DefaultAppResult = {
  ok: boolean;
  message: string;
  openedSettings: boolean;
};

export const DEFAULT_APP_PROMPT_STORAGE_KEY = "tomark.defaultAppPrompt.v1";

export function shouldAutoShowDefaultAppPrompt(options: {
  isTauri: boolean;
  isDev: boolean;
  storage?: Storage | null;
}): boolean {
  if (!options.isTauri || options.isDev) {
    return false;
  }
  try {
    return options.storage?.getItem(DEFAULT_APP_PROMPT_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markDefaultAppPromptSeen(storage?: Storage | null) {
  try {
    storage?.setItem(DEFAULT_APP_PROMPT_STORAGE_KEY, "1");
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function useDefaultAppSetup(options?: {
  autoPrompt?: boolean;
  storage?: Storage | null;
}) {
  const open = ref(false);
  const busy = ref(false);
  const statusMessage = ref("");
  const storage =
    options?.storage ??
    (typeof localStorage === "undefined" ? null : localStorage);

  const platformHint = computed(() => {
    const platform =
      typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
    if (platform.includes("mac")) {
      return "点击后系统可能弹出确认，允许后即可将 tomark 设为 Markdown 默认应用。";
    }
    if (platform.includes("win")) {
      return "将打开 Windows 默认应用设置，请搜索 .md 并选择 tomark。";
    }
    return "请在系统设置中将 .md / .markdown 的默认应用设为 tomark。";
  });

  function dismissPrompt() {
    markDefaultAppPromptSeen(storage);
    open.value = false;
  }

  function showPrompt() {
    open.value = true;
  }

  async function requestDefaultApp(): Promise<DefaultAppResult> {
    busy.value = true;
    statusMessage.value = "";
    try {
      const result = await invoke<DefaultAppResult>(
        "request_default_markdown_app",
      );
      // OS APIs only report that we requested / opened settings — not a verified
      // default-handler state. Close after a successful handoff; keep open on errors.
      if (result.ok || result.openedSettings) {
        markDefaultAppPromptSeen(storage);
        open.value = false;
        statusMessage.value = "";
      } else {
        statusMessage.value = result.message;
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      statusMessage.value = message;
      return {
        ok: false,
        message,
        openedSettings: false,
      };
    } finally {
      busy.value = false;
    }
  }

  onMounted(async () => {
    if (options?.autoPrompt === false) {
      return;
    }
    try {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (
        shouldAutoShowDefaultAppPrompt({
          isTauri: isTauri(),
          isDev: import.meta.env.DEV,
          storage,
        })
      ) {
        open.value = true;
      }
    } catch {
      // Non-Tauri / unavailable core API — skip auto prompt.
    }
  });

  return {
    open,
    busy,
    statusMessage,
    platformHint,
    showPrompt,
    dismissPrompt,
    requestDefaultApp,
  };
}
