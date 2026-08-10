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
  const close = vi.fn(async () => undefined);
  const minimize = vi.fn(async () => undefined);
  const toggleMaximize = vi.fn(async () => undefined);
  const isMaximized = vi.fn(async () => false);
  const startDragging = vi.fn(async () => undefined);
  const onResized = vi.fn(async () => vi.fn());
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
    appWindow: {
      onCloseRequested,
      destroy,
      close,
      minimize,
      toggleMaximize,
      isMaximized,
      startDragging,
      onResized,
      listen,
    },
    close,
    destroy,
    getAppExitHandler: () => appExitHandler,
    getCloseHandler: () => closeHandler,
    isMaximized,
    invoke,
    listen,
    minimize,
    onCloseRequested,
    onResized,
    reset: () => {
      closeHandler = null;
      appExitHandler = null;
      unlisten.mockClear();
      unlistenAppExit.mockClear();
      destroy.mockClear();
      close.mockClear();
      minimize.mockClear();
      toggleMaximize.mockClear();
      isMaximized.mockClear();
      isMaximized.mockResolvedValue(false);
      startDragging.mockClear();
      onResized.mockClear();
      invoke.mockClear();
      listen.mockClear();
      onCloseRequested.mockClear();
    },
    startDragging,
    toggleMaximize,
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

const menuMocks = vi.hoisted(() => {
  let lastHandlers: { isBlocked?: () => boolean } | null = null;
  let fileOpsViaMenu = true;
  const popupFileMenu = vi.fn(async () => undefined);
  return {
    getLastHandlers: () => lastHandlers,
    installAppMenu: vi.fn(async (handlers: { isBlocked?: () => boolean }) => {
      lastHandlers = handlers;
      return {
        fileOpsViaMenu,
        popupFileMenu: fileOpsViaMenu ? null : popupFileMenu,
        dispose: vi.fn(),
      };
    }),
    popupFileMenu,
    reset: () => {
      lastHandlers = null;
      fileOpsViaMenu = true;
      popupFileMenu.mockClear();
      // cleared below after mock is created
    },
    setFileOpsViaMenu: (value: boolean) => {
      fileOpsViaMenu = value;
    },
  };
});

vi.mock("@/app/useAppMenu", () => ({
  installAppMenu: (...args: unknown[]) =>
    menuMocks.installAppMenu(...(args as [{ isBlocked?: () => boolean }])),
}));

const platformMocks = vi.hoisted(() => ({
  isMacOS: vi.fn(() => false),
  isWindows: vi.fn(() => false),
}));

vi.mock("@/shared/isMacOS", () => ({
  isMacOS: () => platformMocks.isMacOS(),
}));

vi.mock("@/shared/isWindows", () => ({
  isWindows: () => platformMocks.isWindows(),
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
    renderedSource: ref("# sample"),
    projection: ref(null),
    renderMode: ref("fallback"),
    editableSyncToken: ref(0),
    selectionRecovery: ref(null),
    locate: vi.fn(),
    syncNow: previewMocks.syncNow,
    isCurrent: previewMocks.isCurrent,
    attachPreview: vi.fn(),
    refreshPreview: Object.assign(vi.fn(), { cancel: vi.fn() }),
    beginOwnEdit: vi.fn(),
    endOwnEdit: vi.fn(),
    syncAfterOwnEdit: vi.fn(),
    setPaused: vi.fn(),
    flushEditSession: vi.fn(async () => undefined),
  }),
}));

const PaneStub = defineComponent({
  setup() {
    return () => h("div", { class: "pane-stub" });
  },
});

import AppShell from "@/app/AppShell.vue";
import SettingsDrawer from "@/app/SettingsDrawer.vue";

describe("AppShell", () => {
  beforeEach(() => {
    tauriMocks.reset();
    menuMocks.installAppMenu.mockClear();
    menuMocks.reset();
    platformMocks.isMacOS.mockReturnValue(false);
    platformMocks.isWindows.mockReturnValue(false);
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

  it("keeps the default toolbar layout off macOS", async () => {
    platformMocks.isMacOS.mockReturnValue(false);
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

    const toolbar = wrapper.get('[data-testid="app-toolbar"]');
    expect(toolbar.classes()).not.toContain("is-macos-overlay");
    expect(wrapper.find(".toolbar-traffic-spacer").exists()).toBe(false);
    expect(wrapper.find('[data-testid="toolbar-drag-region"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('[data-testid="toolbar-title"]').text()).toContain(
      "未命名.md",
    );
    wrapper.unmount();
  });

  it("renders one Windows titlebar with native file popup and guarded window controls", async () => {
    platformMocks.isWindows.mockReturnValue(true);
    menuMocks.setFileOpsViaMenu(false);
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

    const toolbar = wrapper.get('[data-testid="app-toolbar"]');
    expect(toolbar.classes()).toContain("is-windows-custom");
    expect(wrapper.find(".toolbar-traffic-spacer").exists()).toBe(false);
    expect(wrapper.get('[data-testid="windows-window-controls"]')).toBeTruthy();

    await wrapper.get('[data-testid="windows-file-menu"]').trigger("click");
    expect(menuMocks.popupFileMenu).toHaveBeenCalledWith(0, 0);

    const dragRegion = wrapper.get('[data-testid="windows-drag-region"]');
    expect(dragRegion.attributes("data-tauri-drag-region")).toBeUndefined();
    dragRegion.element.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    await flushPromises();
    expect(tauriMocks.startDragging).toHaveBeenCalledOnce();

    await wrapper.get('[data-testid="window-minimize"]').trigger("click");
    await flushPromises();
    expect(tauriMocks.minimize).toHaveBeenCalledOnce();
    await wrapper.get('[data-testid="window-maximize"]').trigger("click");
    await flushPromises();
    expect(tauriMocks.toggleMaximize).toHaveBeenCalledOnce();
    await wrapper.get('[data-testid="window-close"]').trigger("click");
    await flushPromises();
    expect(tauriMocks.close).toHaveBeenCalledOnce();
    expect(tauriMocks.destroy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("merges toolbar with macOS overlay titlebar spacing and drag region", async () => {
    platformMocks.isMacOS.mockReturnValue(true);
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

    const toolbar = wrapper.get('[data-testid="app-toolbar"]');
    expect(toolbar.classes()).toContain("is-macos-overlay");
    expect(toolbar.classes()).not.toContain("is-windows-custom");
    expect(wrapper.find('[data-testid="windows-window-controls"]').exists()).toBe(
      false,
    );

    const spacer = wrapper.get(".toolbar-traffic-spacer");
    expect(spacer.attributes("data-tauri-drag-region")).toBeDefined();
    expect(spacer.attributes("aria-hidden")).toBe("true");

    const dragRegion = wrapper.get('[data-testid="toolbar-drag-region"]');
    expect(dragRegion.attributes("data-tauri-drag-region")).toBeDefined();

    const title = wrapper.get('[data-testid="toolbar-title"]');
    expect(title.attributes("data-tauri-drag-region")).toBeUndefined();
    await title.trigger("click");
    expect(title.text()).toContain("未命名.md");

    wrapper.unmount();
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

  it("refuses stale preview format actions", async () => {
    const applyFormatChange = vi.fn(() => true);
    const EditorPaneStub = defineComponent({
      setup(_props, { expose }) {
        expose({
          revealSourceLine: vi.fn(),
          applyFormatChange,
          getValue: () => "# sample",
        });
        return () => h("div", { class: "editor-pane-stub" });
      },
    });
    const PreviewPaneStub = defineComponent({
      emits: ["format-selection"],
      setup(_props, { emit }) {
        return () =>
          h(
            "button",
            {
              class: "preview-format",
              onClick: () =>
                emit("format-selection", {
                  action: { type: "toggle", format: "bold" },
                  selection: {
                    from: 2,
                    to: 8,
                    blockAnchorId: "tm-a-1",
                    sourceLine: 1,
                    active: {
                      bold: false,
                      italic: false,
                      strike: false,
                      code: false,
                      link: false,
                      linkHref: null,
                      ranges: {},
                    },
                    rect: {
                      top: 10,
                      left: 10,
                      bottom: 20,
                      right: 40,
                      width: 30,
                      height: 10,
                    },
                  },
                }),
            },
            "format",
          );
      },
    });
    previewMocks.isCurrent.mockReturnValue(false);

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
    await wrapper.get(".preview-format").trigger("click");
    await flushPromises();

    expect(applyFormatChange).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("预览内容已更新，请重新选择后再设置格式");
    wrapper.unmount();
  });

  it("opens settings from the footer gear and routes help into the same drawer", async () => {
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

    const help = wrapper.get('[data-testid="status-help"]');
    const settings = wrapper.get('[data-testid="status-settings"]');
    expect(
      settings.element.compareDocumentPosition(help.element) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    await settings.trigger("click");
    await flushPromises();
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    expect(document.querySelector('[data-testid="settings-drawer"]')).toBeTruthy();
    expect(
      document
        .querySelector('[data-testid="settings-nav-export"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");

    await help.trigger("click");
    await flushPromises();
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await nextTick();
    expect(
      document
        .querySelector('[data-testid="settings-overlay"]')
        ?.classList.contains("is-shown"),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-testid="settings-nav-help"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(document.querySelector('[data-testid="help-overlay"]')).toBeNull();
    expect(document.querySelector('[data-testid="help-settings-panel"]')).toBeTruthy();
    wrapper.unmount();
  });

  it("blocks native file menu while settings are open or export is busy", async () => {
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

    const handlers = menuMocks.getLastHandlers();
    expect(handlers?.isBlocked).toBeTypeOf("function");
    expect(handlers!.isBlocked!()).toBe(false);

    await wrapper.get('[data-testid="status-settings"]').trigger("click");
    await flushPromises();
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await nextTick();
    expect(handlers!.isBlocked!()).toBe(true);

    const settingsDrawer = wrapper.findComponent(SettingsDrawer);
    settingsDrawer.vm.$emit("export-busy", true);
    await nextTick();
    expect(handlers!.isBlocked!()).toBe(true);
    expect(
      document
        .querySelector('[data-testid="settings-overlay"]')
        ?.classList.contains("is-shown"),
    ).toBe(true);

    settingsDrawer.vm.$emit("export-busy", false);
    await nextTick();
    expect(handlers!.isBlocked!()).toBe(true);

    settingsDrawer.vm.$emit("close");
    await flushPromises();
    await nextTick();
    expect(handlers!.isBlocked!()).toBe(false);
    wrapper.unmount();
  });
});
