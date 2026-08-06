import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";

const tauriMocks = vi.hoisted(() => {
  type CloseHandler = (event: {
    preventDefault: () => void;
  }) => void | Promise<void>;
  type AppExitHandler = () => void;

  let closeHandler: CloseHandler | null = null;
  let appExitHandler: AppExitHandler | null = null;
  const unlisten = vi.fn();
  const unlistenAppExit = vi.fn();
  const destroy = vi.fn(async () => undefined);
  const invoke = vi.fn(async () => undefined);
  const onCloseRequested = vi.fn(async (handler: CloseHandler) => {
    closeHandler = handler;
    return unlisten;
  });
  const listen = vi.fn(async (event: string, handler: AppExitHandler) => {
    if (event === "tomark-app-exit-requested") {
      appExitHandler = handler;
    }
    return unlistenAppExit;
  });

  return {
    appWindow: { onCloseRequested, destroy, listen },
    destroy,
    getAppExitHandler: () => appExitHandler,
    getCloseHandler: () => closeHandler,
    invoke,
    listen,
    onCloseRequested,
    reset: () => {
      closeHandler = null;
      appExitHandler = null;
      unlisten.mockClear();
      unlistenAppExit.mockClear();
      destroy.mockClear();
      invoke.mockClear();
      listen.mockClear();
      onCloseRequested.mockClear();
    },
    unlisten,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => tauriMocks.appWindow,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@/app/useAppMenu", () => ({
  installAppMenu: vi.fn(async () => vi.fn()),
}));

const dirty = ref(false);
const dirtyDialogOpen = ref(false);
let dirtyResolver: ((ok: boolean) => void) | null = null;
const save = vi.fn(async () => true);
const flushAutosave = vi.fn(async () => undefined);
const previewMocks = vi.hoisted(() => ({
  syncNow: vi.fn(async () => true),
  isCurrent: vi.fn(() => true),
}));

vi.mock("@/app/useDocumentSession", () => ({
  useDocumentSession: () => ({
    path: ref<string | null>(null),
    fileName: ref("未命名.md"),
    content: ref("# sample"),
    dirty: computed(() => dirty.value),
    saveStatus: computed(() =>
      dirty.value ? "unsaved" : "saved",
    ),
    title: computed(() =>
      dirty.value ? "tomark — 未命名.md *" : "tomark — 未命名.md",
    ),
    documentVersion: ref(0),
    statusMessage: ref(""),
    dirtyDialogOpen,
    encodingDialogOpen: ref(false),
    saving: ref(false),
    setContent: vi.fn(),
    flushAutosave,
    guardDirty: () => {
      if (!dirty.value) {
        return Promise.resolve(true);
      }
      dirtyDialogOpen.value = true;
      return new Promise<boolean>((resolve) => {
        dirtyResolver = resolve;
      });
    },
    newDocument: vi.fn(),
    openDocument: vi.fn(),
    openDocumentAtPath: vi.fn(async () => true),
    reidentifyDocument: vi.fn(async () => true),
    save,
    saveAs: vi.fn(async () => true),
    convertOverwriteUtf8: vi.fn(async () => true),
    convertSaveAsUtf8: vi.fn(async () => true),
    openEncodingSaveDialog: vi.fn(),
    cancelEncodingSaveDialog: vi.fn(),
    onDirtySave: vi.fn(),
    onDirtyDiscard: () => {
      dirtyDialogOpen.value = false;
      dirtyResolver?.(true);
      dirtyResolver = null;
    },
    onDirtyCancel: () => {
      dirtyDialogOpen.value = false;
      dirtyResolver?.(false);
      dirtyResolver = null;
    },
    dispose: vi.fn(),
  }),
}));

vi.mock("@/app/usePreviewBridge", () => ({
  usePreviewBridge: () => ({
    previewRef: ref(null),
    html: ref(""),
    lineToAnchor: ref(new Map()),
    locate: vi.fn(),
    syncNow: previewMocks.syncNow,
    isCurrent: previewMocks.isCurrent,
    attachPreview: vi.fn(),
    refreshPreview: Object.assign(vi.fn(), { cancel: vi.fn() }),
  }),
}));

const PaneStub = defineComponent({
  setup() {
    return () => h("div", { class: "pane-stub" });
  },
});

import AppShell from "@/app/AppShell.vue";

describe("AppShell", () => {
  beforeEach(() => {
    tauriMocks.reset();
    dirty.value = false;
    dirtyDialogOpen.value = false;
    dirtyResolver = null;
    save.mockClear();
    flushAutosave.mockClear();
    previewMocks.syncNow.mockReset();
    previewMocks.syncNow.mockResolvedValue(true);
    previewMocks.isCurrent.mockReset();
    previewMocks.isCurrent.mockReturnValue(true);
  });

  it("guards a dirty document before destroying the Tauri window", async () => {
    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          EditorPane: PaneStub,
          PreviewPane: PaneStub,
          Suspense: false,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    dirty.value = true;
    await nextTick();

    const closeHandler = tauriMocks.getCloseHandler();
    expect(closeHandler).not.toBeNull();
    const event = { preventDefault: vi.fn() };
    const closing = closeHandler!(event);
    await flushPromises();
    await nextTick();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(dirtyDialogOpen.value).toBe(true);
    const discard = wrapper.get('[data-testid="dirty-discard"]');
    await discard.trigger("click");
    await closing;

    expect(tauriMocks.destroy).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(tauriMocks.unlisten).toHaveBeenCalledOnce();
  });

  it("handles Cmd/Ctrl+S without throwing", async () => {
    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          EditorPane: PaneStub,
          PreviewPane: PaneStub,
          Suspense: false,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(save).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("guards native app exit before confirming it to Rust", async () => {
    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          EditorPane: PaneStub,
          PreviewPane: PaneStub,
          Suspense: false,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    dirty.value = true;
    await nextTick();

    const appExitHandler = tauriMocks.getAppExitHandler();
    expect(appExitHandler).not.toBeNull();
    appExitHandler!();
    await flushPromises();
    await nextTick();
    expect(dirtyDialogOpen.value).toBe(true);

    await wrapper.get('[data-testid="dirty-discard"]').trigger("click");
    await flushPromises();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("confirm_app_exit");
    wrapper.unmount();
  });

  it("does not reveal a source line from a superseded preview render", async () => {
    const revealSourceLine = vi.fn();
    const EditorPaneStub = defineComponent({
      setup(_props, { expose }) {
        expose({ revealSourceLine });
        return () => h("div", { class: "editor-pane-stub" });
      },
    });
    const PreviewPaneStub = defineComponent({
      emits: ["locate-source"],
      setup(_props, { emit }) {
        return () =>
          h(
            "button",
            {
              class: "preview-locate",
              onClick: () => emit("locate-source", 3),
            },
            "locate",
          );
      },
    });
    previewMocks.syncNow.mockResolvedValue(false);

    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          EditorPane: EditorPaneStub,
          PreviewPane: PreviewPaneStub,
          Suspense: false,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.get(".preview-locate").trigger("click");
    await flushPromises();

    expect(previewMocks.syncNow).toHaveBeenCalled();
    expect(revealSourceLine).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not reuse a line clicked in stale preview content", async () => {
    const revealSourceLine = vi.fn();
    const EditorPaneStub = defineComponent({
      setup(_props, { expose }) {
        expose({ revealSourceLine });
        return () => h("div", { class: "editor-pane-stub" });
      },
    });
    const PreviewPaneStub = defineComponent({
      emits: ["locate-source"],
      setup(_props, { emit }) {
        return () =>
          h(
            "button",
            {
              class: "preview-locate",
              onClick: () => emit("locate-source", 3),
            },
            "locate",
          );
      },
    });
    previewMocks.isCurrent
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          EditorPane: EditorPaneStub,
          PreviewPane: PreviewPaneStub,
          Suspense: false,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.get(".preview-locate").trigger("click");
    await flushPromises();

    expect(previewMocks.syncNow).toHaveBeenCalled();
    expect(revealSourceLine).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("预览内容已更新，请重新点击定位");
    wrapper.unmount();
  });
});
