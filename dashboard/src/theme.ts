export type ThemeMode = "auto" | "light" | "dark";

export const THEME_MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "auto", label: "跟随系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

const KEY = "eb-theme";

/** localStorage 在隐私窗口 / 禁用站点数据时可能抛错，读不到就退回跟随系统 */
export function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function saveMode(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* 存不下就只对本次页面生效 */
  }
}

export const isDark = (mode: ThemeMode, systemDark: boolean): boolean =>
  mode === "dark" || (mode === "auto" && systemDark);

/** 写到 <html> 上，页面背景、表格、原生控件与图表一起切换 */
export const colorScheme = (mode: ThemeMode): string => (mode === "auto" ? "light dark" : mode);

const listeners = new Set<() => void>();
let current: ThemeMode | null = null;
let original = "";

/** 配色是页面级偏好：所有实例共享同一个模式，任一实例切换时全部跟随 */
export function currentMode(): ThemeMode {
  return (current ??= loadMode());
}

export function setMode(mode: ThemeMode): void {
  current = mode;
  saveMode(mode);
  document.documentElement.style.colorScheme = colorScheme(mode);
  for (const f of listeners) f();
}

/** 首个订阅者把配色写到 <html>，最后一个退订时还原挂载前的值 */
export function subscribeMode(onChange: () => void): () => void {
  const html = document.documentElement;
  if (listeners.size === 0) {
    original = html.style.colorScheme;
    html.style.colorScheme = colorScheme(currentMode());
  }
  listeners.add(onChange);
  return () => {
    if (listeners.delete(onChange) && listeners.size === 0) html.style.colorScheme = original;
  };
}
