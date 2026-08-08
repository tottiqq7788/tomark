<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppTopDrawer from "@/app/AppTopDrawer.vue";
import ExportSettingsPanel from "@/app/settings/ExportSettingsPanel.vue";
import HelpSettingsPanel from "@/app/settings/HelpSettingsPanel.vue";
import {
  DEFAULT_SETTINGS_MENU_ID,
  SETTINGS_MENUS,
  type SettingsMenuId,
} from "@/app/settings/settingsMenus";
import type { EncodingHint } from "@/shared/types";

const props = withDefaults(
  defineProps<{
    open: boolean;
    initialMenu?: SettingsMenuId;
    markdownSource: string;
    documentPath: string | null;
    fileName: string;
    busy?: boolean;
    canReidentify?: boolean;
  }>(),
  {
    initialMenu: DEFAULT_SETTINGS_MENU_ID,
    busy: false,
    canReidentify: false,
  },
);

const emit = defineEmits<{
  close: [];
  "export-busy": [busy: boolean];
  "request-default-app": [];
  reidentify: [hint: EncodingHint];
}>();

const drawerRef = ref<InstanceType<typeof AppTopDrawer> | null>(null);
const activeMenu = ref<SettingsMenuId>(props.initialMenu);
const menus = SETTINGS_MENUS;

const panelTitle = computed(() => {
  const found = menus.find((item) => item.id === activeMenu.value);
  return found?.label ?? "设置";
});

watch(
  () => [props.open, props.initialMenu] as const,
  ([open, menu]) => {
    if (open) {
      activeMenu.value = menu ?? DEFAULT_SETTINGS_MENU_ID;
    }
  },
);

function suspendFocusTrap(): () => void {
  return drawerRef.value?.suspendFocusTrap() ?? (() => undefined);
}

defineExpose({ suspendFocusTrap });
</script>

<template>
  <AppTopDrawer
    ref="drawerRef"
    :open="open"
    title="设置"
    test-id-prefix="settings"
    close-aria-label="关闭设置"
    :warm="false"
    wide
    @close="emit('close')"
  >
    <div class="settings-layout" data-testid="settings-layout">
      <nav class="settings-nav" aria-label="设置菜单">
        <button
          v-for="item in menus"
          :key="item.id"
          type="button"
          class="settings-nav-item"
          :class="{ 'is-active': activeMenu === item.id }"
          :data-testid="`settings-nav-${item.id}`"
          :aria-current="activeMenu === item.id ? 'page' : undefined"
          @click="activeMenu = item.id"
        >
          {{ item.label }}
        </button>
      </nav>
      <section class="settings-panel" :aria-label="panelTitle">
        <ExportSettingsPanel
          v-if="activeMenu === 'export'"
          :markdown-source="markdownSource"
          :document-path="documentPath"
          :file-name="fileName"
          :disabled="busy"
          @busy="(value) => emit('export-busy', value)"
        />
        <HelpSettingsPanel
          v-else-if="activeMenu === 'help'"
          :active="activeMenu === 'help'"
          :can-reidentify="canReidentify"
          @request-default-app="emit('request-default-app')"
          @reidentify="(hint) => emit('reidentify', hint)"
        />
      </section>
    </div>
  </AppTopDrawer>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
  height: 100%;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 8px;
  border-right: 1px solid #e5e7eb;
  background: #f8fafc;
  overflow: auto;
}

.settings-nav-item {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #374151;
  font-size: 13px;
  font-weight: 550;
  text-align: left;
  cursor: pointer;
}

.settings-nav-item:hover {
  background: #eef2ff;
  color: #1d4ed8;
}

.settings-nav-item.is-active {
  background: #dbeafe;
  color: #1d4ed8;
}

.settings-nav-item:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
}

.settings-panel {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px 18px 22px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.settings-panel::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
</style>
