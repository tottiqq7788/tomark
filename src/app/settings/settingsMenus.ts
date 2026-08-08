export const SETTINGS_MENUS = [
  { id: "export", label: "导出" },
  { id: "help", label: "说明" },
] as const;

export type SettingsMenuId = (typeof SETTINGS_MENUS)[number]["id"];

export const DEFAULT_SETTINGS_MENU_ID: SettingsMenuId = SETTINGS_MENUS[0].id;

export function isSettingsMenuId(value: string): value is SettingsMenuId {
  return SETTINGS_MENUS.some((item) => item.id === value);
}
