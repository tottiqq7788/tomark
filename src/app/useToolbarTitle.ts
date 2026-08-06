import { computed, ref, watch, type Ref } from "vue";

/**
 * Toolbar title toggles between file name and absolute path when a path exists.
 */
export function useToolbarTitle(
  path: Ref<string | null>,
  fileName: Ref<string>,
  dirty: Ref<boolean>,
  documentVersion: Ref<number>,
  statusMessage: Ref<string>,
) {
  const showFullPath = ref(false);

  const toolbarLabel = computed(() => {
    const dirtyMark = dirty.value ? " *" : "";
    if (showFullPath.value && path.value) {
      return `${path.value}${dirtyMark}`;
    }
    return `${fileName.value}${dirtyMark}`;
  });

  const toolbarTitleHint = computed(() => {
    if (!path.value) {
      return "尚未保存到文件，暂无完整路径";
    }
    return showFullPath.value ? "点击显示文件名" : "点击显示完整路径";
  });

  function toggleToolbarPath() {
    if (!path.value) {
      statusMessage.value = "尚未保存到文件，暂无完整路径";
      showFullPath.value = false;
      return;
    }
    showFullPath.value = !showFullPath.value;
  }

  watch(path, () => {
    showFullPath.value = false;
  });

  watch(documentVersion, () => {
    showFullPath.value = false;
  });

  return {
    showFullPath,
    toolbarLabel,
    toolbarTitleHint,
    toggleToolbarPath,
  };
}
