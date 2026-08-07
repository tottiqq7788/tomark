<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppTopDrawer from "@/app/AppTopDrawer.vue";
import ExportSettingsPanel from "@/app/settings/ExportSettingsPanel.vue";

export type SettingsMenuId = "export";

const props = defineProps<{
  open: boolean;
  markdownSource: string;
  documentPath: string | null;
  fileName: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "export-busy": [busy: boolean];
  "status-message": [message: string];
}>();

const activeMenu = ref<SettingsMenuId>("export");

const menus: { id: SettingsMenuId; label: string }[] = [
  { id: "export", label: "导出" },
];

const panelTitle = computed(() => {
  const found = menus.find((item) => item.id === activeMenu.value);
  return found?.label ?? "设置";
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      activeMenu.value = "export";
    }
  },
);
</script>

<template>
  <AppTopDrawer
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
          @status-message="(message) => emit('status-message', message)"
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
