<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { trapFocus } from "@/shared/focusTrap";
import {
  createMermaidViewportState,
  fitMermaidViewport,
  mermaidViewportStageStyle,
  panMermaidViewport,
  parseSvgNaturalSize,
  resetMermaidViewport,
  resizeMermaidViewport,
  zoomMermaidViewport,
  zoomMermaidViewportIn,
  zoomMermaidViewportOut,
  type MermaidViewportState,
} from "@/preview/useMermaidViewport";
import {
  addFlowLink,
  addFlowNode,
  deleteFlowEdge,
  deleteFlowNode,
  findFlowEdgeByDataId,
  findFlowNodeByDomId,
  parseFlowchartSource,
  updateFlowEdgeText,
  updateFlowNodeText,
  type FlowEdgeDef,
  type FlowNodeDef,
} from "@/preview/mermaidEditing/flowchartSourceModel";

export type MermaidVisualEditorMode =
  | "select"
  | "add-node"
  | "link"
  | "delete";

const props = defineProps<{
  open: boolean;
  /** Authoritative fence body snapshot when the dialog opened. */
  initialSource: string;
  stale?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [nextSource: string];
}>();

const dialogRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const draft = ref("");
const svgHtml = ref("");
const renderError = ref<string | null>(null);
const rendering = ref(false);
const mode = ref<MermaidVisualEditorMode>("select");
const selectedNodeId = ref<string | null>(null);
const selectedEdgeId = ref<string | null>(null);
const linkStartId = ref<string | null>(null);
const labelDraft = ref("");
const status = ref("");
const state = ref<MermaidViewportState | null>(null);
const dragging = ref(false);
const staleLocal = ref(false);

let disposeTrap: (() => void) | null = null;
let lastX = 0;
let lastY = 0;
let resizeObserver: ResizeObserver | null = null;
let renderToken = 0;

const dirty = computed(() => draft.value !== props.initialSource);
const model = computed(() => {
  const parsed = parseFlowchartSource(draft.value);
  return parsed.ok ? parsed.model : null;
});
const selectedNode = computed<FlowNodeDef | null>(() => {
  if (!model.value || !selectedNodeId.value) {
    return null;
  }
  return model.value.nodes.find((n) => n.id === selectedNodeId.value) ?? null;
});
const selectedEdge = computed<FlowEdgeDef | null>(() => {
  if (!model.value || !selectedEdgeId.value) {
    return null;
  }
  return model.value.edges.find((e) => e.id === selectedEdgeId.value) ?? null;
});
const scalePercent = computed(() =>
  state.value ? Math.round(state.value.scale * 100) : 100,
);
const stageStyle = computed(() =>
  state.value
    ? mermaidViewportStageStyle(state.value)
    : { width: "0px", height: "0px", transform: "none" },
);
const canSave = computed(
  () =>
    props.open &&
    !props.stale &&
    !staleLocal.value &&
    dirty.value &&
    !rendering.value &&
    !renderError.value &&
    Boolean(model.value?.capability.editable),
);

function clearSelection() {
  selectedNodeId.value = null;
  selectedEdgeId.value = null;
  linkStartId.value = null;
  labelDraft.value = "";
}

function measureAndInit() {
  const viewport = viewportRef.value;
  if (!viewport || !props.open || !svgHtml.value) {
    return;
  }
  const natural = parseSvgNaturalSize(svgHtml.value);
  const rect = viewport.getBoundingClientRect();
  state.value = createMermaidViewportState(natural, {
    width: rect.width,
    height: rect.height,
  });
}

async function rerenderDraft(options?: { fit?: boolean }) {
  const token = ++renderToken;
  rendering.value = true;
  renderError.value = null;
  try {
    const { renderMermaidSvg } = await import("@/preview/renderMermaid");
    const svg = await renderMermaidSvg(draft.value);
    if (token !== renderToken) {
      return;
    }
    svgHtml.value = svg;
    await nextTick();
    if (options?.fit || !state.value) {
      measureAndInit();
    } else {
      const natural = parseSvgNaturalSize(svg);
      if (state.value) {
        state.value = {
          ...state.value,
          naturalWidth: natural.width,
          naturalHeight: natural.height,
        };
      }
    }
  } catch (error) {
    if (token !== renderToken) {
      return;
    }
    renderError.value =
      error instanceof Error ? error.message : String(error);
    svgHtml.value = "";
  } finally {
    if (token === renderToken) {
      rendering.value = false;
    }
  }
}

function applyDraft(next: string | null, message?: string) {
  if (next == null) {
    status.value = message ?? "无法应用该操作";
    return;
  }
  draft.value = next;
  status.value = message ?? "";
  void rerenderDraft();
}

function setMode(next: MermaidVisualEditorMode) {
  mode.value = next;
  if (next !== "link") {
    linkStartId.value = null;
  }
  if (next !== "select") {
    clearSelection();
  }
  status.value =
    next === "add-node"
      ? "点击画布空白处添加矩形节点"
      : next === "link"
        ? "依次点击两个节点以连线"
        : next === "delete"
          ? "点击节点或连线以删除"
          : "";
}

function onAddNodeConfirm() {
  applyDraft(addFlowNode(draft.value, "新节点"), "已添加节点");
  mode.value = "select";
  linkStartId.value = null;
}

function onLabelCommit() {
  if (selectedNode.value) {
    applyDraft(
      updateFlowNodeText(draft.value, selectedNode.value.id, labelDraft.value),
      "已更新节点文字",
    );
    return;
  }
  if (selectedEdge.value) {
    applyDraft(
      updateFlowEdgeText(draft.value, selectedEdge.value.id, labelDraft.value),
      "已更新连线文字",
    );
  }
}

function hitTest(target: EventTarget | null): {
  node: FlowNodeDef | null;
  edge: FlowEdgeDef | null;
} {
  if (!(target instanceof Element) || !model.value) {
    return { node: null, edge: null };
  }
  const nodeEl = target.closest(".node, .nodeLabel, g.node");
  if (nodeEl) {
    const id =
      nodeEl.getAttribute("id") ||
      nodeEl.closest("[id]")?.getAttribute("id") ||
      "";
    const node = findFlowNodeByDomId(model.value, id);
    if (node) {
      return { node, edge: null };
    }
  }
  const edgeEl = target.closest(".edgePath, .edgeLabel, g.edgePath, g.edgeLabel");
  if (edgeEl) {
    const dataId =
      edgeEl.getAttribute("data-id") ||
      edgeEl.closest("[data-id]")?.getAttribute("data-id") ||
      "";
    const edge = findFlowEdgeByDataId(model.value, dataId);
    if (edge) {
      return { node: null, edge };
    }
  }
  return { node: null, edge: null };
}

function onCanvasClick(event: MouseEvent) {
  if (!props.open || props.stale || staleLocal.value) {
    return;
  }
  const hit = hitTest(event.target);
  if (mode.value === "add-node") {
    if (hit.node || hit.edge) {
      status.value = "请点击空白处添加节点";
      return;
    }
    applyDraft(addFlowNode(draft.value, "新节点"), "已添加节点");
    mode.value = "select";
    linkStartId.value = null;
    return;
  }
  if (mode.value === "link") {
    if (!hit.node) {
      status.value = "请点击节点以连线";
      return;
    }
    if (!linkStartId.value) {
      linkStartId.value = hit.node.id;
      status.value = `已选起点 ${hit.node.id}，再点终点`;
      return;
    }
    applyDraft(
      addFlowLink(draft.value, linkStartId.value, hit.node.id),
      "已添加连线",
    );
    linkStartId.value = null;
    mode.value = "select";
    return;
  }
  if (mode.value === "delete") {
    if (hit.node) {
      applyDraft(deleteFlowNode(draft.value, hit.node.id), "已删除节点");
      clearSelection();
      return;
    }
    if (hit.edge) {
      applyDraft(deleteFlowEdge(draft.value, hit.edge.id), "已删除连线");
      clearSelection();
      return;
    }
    status.value = "请点击要删除的节点或连线";
    return;
  }
  // select
  if (hit.node) {
    selectedNodeId.value = hit.node.id;
    selectedEdgeId.value = null;
    labelDraft.value = hit.node.text;
    status.value = `已选节点 ${hit.node.id}`;
    return;
  }
  if (hit.edge) {
    selectedEdgeId.value = hit.edge.id;
    selectedNodeId.value = null;
    labelDraft.value = hit.edge.text;
    status.value = `已选连线 ${hit.edge.start} → ${hit.edge.end}`;
    return;
  }
  clearSelection();
}

function onSave() {
  if (!canSave.value) {
    return;
  }
  emit("save", draft.value);
}

function onCancel() {
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    onSave();
    return;
  }
  if (!state.value) {
    return;
  }
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    state.value = zoomMermaidViewportIn(state.value);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    state.value = zoomMermaidViewportOut(state.value);
  } else if (event.key === "0") {
    event.preventDefault();
    state.value = fitMermaidViewport(state.value);
  }
}

function onWheel(event: WheelEvent) {
  if (!state.value || !(event.ctrlKey || event.metaKey)) {
    return;
  }
  event.preventDefault();
  const viewport = viewportRef.value;
  if (!viewport) {
    return;
  }
  const rect = viewport.getBoundingClientRect();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  state.value = zoomMermaidViewport(state.value, factor, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
}

function onPointerDown(event: PointerEvent) {
  if (!state.value || event.button !== 0) {
    return;
  }
  // Only pan when not interacting with a graph element in select modes that
  // need clicks. Middle-button free; left-button pans empty background.
  const hit = hitTest(event.target);
  if (hit.node || hit.edge) {
    return;
  }
  if (mode.value === "add-node" || mode.value === "link" || mode.value === "delete") {
    return;
  }
  dragging.value = true;
  lastX = event.clientX;
  lastY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || !state.value) {
    return;
  }
  state.value = panMermaidViewport(
    state.value,
    event.clientX - lastX,
    event.clientY - lastY,
  );
  lastX = event.clientX;
  lastY = event.clientY;
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) {
    return;
  }
  dragging.value = false;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}

function disposeResources() {
  disposeTrap?.();
  disposeTrap = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  renderToken += 1;
}

watch(
  () => props.open,
  async (open) => {
    disposeResources();
    if (!open) {
      draft.value = "";
      svgHtml.value = "";
      renderError.value = null;
      clearSelection();
      mode.value = "select";
      status.value = "";
      state.value = null;
      staleLocal.value = false;
      return;
    }
    draft.value = props.initialSource;
    staleLocal.value = false;
    clearSelection();
    mode.value = "select";
    await rerenderDraft({ fit: true });
    await nextTick();
    const dialog = dialogRef.value;
    if (dialog) {
      disposeTrap = trapFocus(dialog);
      dialog.focus();
    }
    const viewport = viewportRef.value;
    if (viewport && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (!state.value) {
          measureAndInit();
          return;
        }
        const rect = viewport.getBoundingClientRect();
        state.value = resizeMermaidViewport(state.value, {
          width: rect.width,
          height: rect.height,
        });
      });
      resizeObserver.observe(viewport);
    }
  },
);

watch(
  () => props.stale,
  (stale) => {
    if (stale) {
      staleLocal.value = true;
      status.value = "预览已更新，请关闭后重新打开编辑器";
    }
  },
);

onBeforeUnmount(() => {
  disposeResources();
});
</script>

<template>
  <div
    v-if="open"
    class="mve-root"
    data-testid="mermaid-visual-editor"
    @keydown="onKeydown"
  >
    <div class="mve-backdrop" data-testid="mermaid-visual-editor-backdrop" @click="onCancel" />
    <div
      ref="dialogRef"
      class="mve-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid 可视化编辑"
      tabindex="-1"
    >
      <header class="mve-header">
        <div class="mve-title">编辑流程图</div>
        <div class="mve-modes" role="toolbar" aria-label="编辑模式">
          <button
            type="button"
            class="mve-mode"
            :class="{ active: mode === 'select' }"
            data-testid="mermaid-edit-mode-select"
            @click="setMode('select')"
          >
            选择
          </button>
          <button
            type="button"
            class="mve-mode"
            :class="{ active: mode === 'add-node' }"
            data-testid="mermaid-edit-mode-add-node"
            @click="setMode('add-node')"
          >
            添加节点
          </button>
          <button
            type="button"
            class="mve-mode"
            :class="{ active: mode === 'link' }"
            data-testid="mermaid-edit-mode-link"
            @click="setMode('link')"
          >
            连线
          </button>
          <button
            type="button"
            class="mve-mode"
            :class="{ active: mode === 'delete' }"
            data-testid="mermaid-edit-mode-delete"
            @click="setMode('delete')"
          >
            删除
          </button>
        </div>
        <div class="mve-zoom">
          <button type="button" class="mve-icon" title="缩小" @click="state && (state = zoomMermaidViewportOut(state))">−</button>
          <span class="mve-scale">{{ scalePercent }}%</span>
          <button type="button" class="mve-icon" title="放大" @click="state && (state = zoomMermaidViewportIn(state))">+</button>
          <button type="button" class="mve-icon" title="适配" @click="state && (state = fitMermaidViewport(state))">适配</button>
          <button type="button" class="mve-icon" title="重置" @click="state && (state = resetMermaidViewport(state))">1:1</button>
        </div>
      </header>

      <div class="mve-body">
        <div
          ref="viewportRef"
          class="mve-viewport"
          data-testid="mermaid-visual-editor-canvas"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @click="onCanvasClick"
        >
          <div v-if="renderError" class="mve-error">{{ renderError }}</div>
          <div v-else class="mve-stage" :style="stageStyle" v-html="svgHtml" />
          <div v-if="rendering" class="mve-loading">渲染中…</div>
        </div>

        <aside class="mve-side">
          <div class="mve-side-title">属性</div>
          <template v-if="selectedNode || selectedEdge">
            <label class="mve-field">
              <span>{{ selectedNode ? `节点 ${selectedNode.id}` : `连线 ${selectedEdge?.start} → ${selectedEdge?.end}` }}</span>
              <input
                v-model="labelDraft"
                type="text"
                data-testid="mermaid-edit-label-input"
                @keydown.enter.prevent="onLabelCommit"
              />
            </label>
            <button
              type="button"
              class="mve-secondary"
              data-testid="mermaid-edit-label-apply"
              @click="onLabelCommit"
            >
              应用文字
            </button>
          </template>
          <template v-else-if="mode === 'add-node'">
            <button
              type="button"
              class="mve-secondary"
              data-testid="mermaid-edit-add-node-confirm"
              @click="onAddNodeConfirm"
            >
              添加矩形节点
            </button>
            <p class="mve-hint">也可点击画布空白处添加</p>
          </template>
          <p v-else class="mve-hint">点击节点或连线以编辑文字</p>
          <p class="mve-status" data-testid="mermaid-edit-status">{{ status }}</p>
          <p v-if="stale || staleLocal" class="mve-stale">草稿已过期</p>
        </aside>
      </div>

      <footer class="mve-footer">
        <button
          type="button"
          class="mve-secondary"
          data-testid="mermaid-edit-cancel"
          @click="onCancel"
        >
          取消
        </button>
        <button
          type="button"
          class="mve-primary"
          data-testid="mermaid-edit-save"
          :disabled="!canSave"
          @click="onSave"
        >
          保存
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mve-root {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mve-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
}

.mve-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1100px, calc(100vw - 32px));
  height: min(780px, calc(100vh - 32px));
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}

.mve-header,
.mve-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.mve-footer {
  border-bottom: none;
  border-top: 1px solid #e5e7eb;
  justify-content: flex-end;
}

.mve-title {
  font-weight: 650;
  color: #111827;
  margin-right: auto;
}

.mve-modes,
.mve-zoom {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mve-mode,
.mve-icon,
.mve-secondary,
.mve-primary {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.mve-mode.active {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.mve-primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.mve-primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.mve-scale {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #4b5563;
}

.mve-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 240px;
}

.mve-viewport {
  position: relative;
  overflow: hidden;
  background: #f8fafc;
  cursor: grab;
}

.mve-stage {
  transform-origin: 0 0;
}

.mve-stage :deep(svg) {
  display: block;
}

.mve-error,
.mve-loading {
  position: absolute;
  inset: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b91c1c;
  font-size: 13px;
}

.mve-loading {
  color: #64748b;
  pointer-events: none;
}

.mve-side {
  border-left: 1px solid #e5e7eb;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mve-side-title {
  font-weight: 650;
  font-size: 13px;
}

.mve-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #374151;
}

.mve-field input {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}

.mve-hint,
.mve-status,
.mve-stale {
  font-size: 12px;
  color: #6b7280;
  margin: 0;
}

.mve-stale {
  color: #b45309;
}
</style>
