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

let owners = 0;
let original = "";

/** <html> 是全局的：多个实例并存时，只在最后一个释放后还原挂载前的值 */
export function claimScheme(scheme: string): void {
  const html = document.documentElement;
  if (owners++ === 0) original = html.style.colorScheme;
  html.style.colorScheme = scheme;
}

export function releaseScheme(): void {
  if (owners > 0 && --owners === 0) document.documentElement.style.colorScheme = original;
}
