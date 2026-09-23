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
