export type Format = "int" | "pct" | "dur" | ((v: number) => string);

const FORMATS = {
  int: (v: number) => Math.round(v).toLocaleString("en-US"),
  /** 入参已是百分数（0~100） */
  pct: (v: number) => `${Math.round(v * 10) / 10}%`,
  /** 入参为秒 */
  dur: (s: number) => {
    if (s < 90) return `${Math.round(s)}s`;
    if (s < 5400) return `${Math.round(s / 6) / 10}m`;
    return `${Math.round(s / 360) / 10}h`;
  },
};

/** 返回的函数把 null / 空串 / 非数字统一显示为「—」 */
export function formatter(format: Format = "int"): (v: unknown) => string {
  const fn = typeof format === "function" ? format : FORMATS[format];
  return (v) => {
    if (v == null || v === "") return "—";
    const n = Number(v);
    return Number.isFinite(n) ? fn(n) : String(v);
  };
}

/** 涨跌幅文案；对照值为 0 或缺失时无从比较，只给「—」 */
export function compareText(
  cur: unknown,
  prev: unknown,
  label: string,
  format: Format = "int",
): { text: string; dir: "up" | "down" | null } {
  const missing = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
  const c = Number(cur), p = Number(prev);
  if (missing(cur) || missing(prev) || !Number.isFinite(c) || !Number.isFinite(p) || p === 0) {
    return { text: `— vs ${label}`, dir: null };
  }
  const tail = `vs ${label}（${formatter(format)(p)}）`;
  if (c === p) return { text: `持平 ${tail}`, dir: null };
  const pct = Math.round((Math.abs(c - p) / Math.abs(p)) * 1000) / 10;
  return c > p ? { text: `↑ ${pct}% ${tail}`, dir: "up" } : { text: `↓ ${pct}% ${tail}`, dir: "down" };
}
