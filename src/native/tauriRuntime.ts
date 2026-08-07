type TauriInternals = {
  invoke?: (
    cmd: string,
    args?: Record<string, unknown>,
    options?: unknown,
  ) => Promise<unknown>;
};

function getTauriInternals(): TauriInternals | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
}

/** True only when the official Tauri IPC bridge is actually present. */
export function isTauriIpcReady(): boolean {
  return typeof getTauriInternals()?.invoke === "function";
}

export function assertTauriIpcReady(action = "该操作"): void {
  if (!isTauriIpcReady()) {
    throw new Error(
      `${action}仅在 tomark 桌面应用内可用（请使用 tauri:dev / 打包应用窗口，不要用浏览器标签页）`,
    );
  }
}

export async function invokeTauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  assertTauriIpcReady("Tauri 调用");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
