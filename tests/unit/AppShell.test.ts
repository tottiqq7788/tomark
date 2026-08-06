import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";

const tauriMocks = vi.hoisted(() => {
  type CloseHandler = (event: {
    preventDefault: () => void;
  }) => void | Promise<void>;

  let closeHandler: CloseHandler | null = null;
  const unlisten = vi.fn();
  const destroy = vi.fn(async () => undefined);
  const onCloseRequested = vi.fn(async (handler: CloseHandler) => {
    closeHandler = handler;
    return unlisten;
  });

  return {
    appWindow: { onCloseRequested, destroy },
    destroy,
    getCloseHandler: () => closeHandler,
    onCloseRequested,
    reset: () => {
      closeHandler = null;
      unlisten.mockClear();
      destroy.mockClear();
      onCloseRequested.mockClear();
    },
    unlisten,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => tauriMocks.appWindow,
}));

vi.mock("@/app/useAppMenu", () => ({
  installAppMenu: vi.fn(async () => vi.fn()),
}));

const dirty = ref(false);
const dirtyDialogOpen = ref(false);
let dirtyResolver: ((ok: boolean) => void) | null = null;
const save = vi.fn(async () => true);
const flushAutosave = vi.fn(async () => undefined);

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
    save,
    saveAs: vi.fn(async () => true),
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
});
