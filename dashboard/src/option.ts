import type { EChartsOption, SeriesOption } from "echarts";
import { formatter, type Format } from "./format.js";
import { finite, mergeTail, sortByTotal } from "./source.js";
import type { Source } from "./types.js";

const BASE: EChartsOption = {
  aria: { enabled: true },
  backgroundColor: "transparent",
  toolbox: { feature: { dataView: { readOnly: true }, saveAsImage: {} } },
};

/** 柱末端数值标签不在 outerBounds 的避让范围内，右侧要手动留白 */
const LABEL_ROOM = 56;

const dayLabel = (d: unknown) => (typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d) ? d.slice(5) : String(d));

const seriesCount = (source: Source) => Math.max(0, (source[0]?.length ?? 1) - 1);

export function lineOption(source: Source, opts: { format?: Format; yMax?: number } = {}): EChartsOption {
  const fmt = formatter(opts.format);
  const n = seriesCount(source);
  return {
    ...BASE,
    legend: { show: n > 1 },
    tooltip: { trigger: "axis", valueFormatter: fmt },
    dataset: { source },
    xAxis: { type: "category", axisLabel: { formatter: dayLabel } },
    yAxis: { type: "value", max: opts.yMax, axisLabel: { formatter: fmt } },
    series: Array.from({ length: n }, (): SeriesOption => ({ type: "line" })),
  };
}

export function barOption(
  source: Source,
  opts: { format?: Format; horizontal?: boolean; stack?: boolean; topN?: number; otherLabel?: string } = {},
): EChartsOption {
  const fmt = formatter(opts.format);
  const n = seriesCount(source);
  const data = !opts.horizontal ? source
    : opts.topN != null ? mergeTail(source, opts.topN, opts.otherLabel) : sortByTotal(source);
  const valueAxis = { type: "value" as const, axisLabel: { formatter: fmt } };
  const labelled = opts.horizontal && !opts.stack && n === 1;
  return {
    ...BASE,
    ...(labelled ? { grid: { right: LABEL_ROOM } } : {}),
    legend: { show: n > 1 },
    tooltip: { trigger: "axis", valueFormatter: fmt },
    dataset: { source: data },
    ...(opts.horizontal
      ? { xAxis: valueAxis, yAxis: { type: "category", inverse: true } }
      : { xAxis: { type: "category", axisLabel: { formatter: dayLabel } }, yAxis: valueAxis }),
    series: Array.from({ length: n }, (_, i): SeriesOption => ({
      type: "bar",
      stack: opts.stack ? "total" : undefined,
      encode: opts.horizontal ? { y: 0, x: i + 1 } : undefined,
      label: labelled
        ? { show: true, position: "right", formatter: (p: { value: unknown }) => fmt((p.value as unknown[])[1]) }
        : undefined,
    })),
  };
}

/** 横向柱按步骤顺序排列，标签「人数（占首步 %）」 */
export function funnelOption(source: Source, opts: { format?: Format } = {}): EChartsOption {
  const fmt = formatter(opts.format);
  const first = Number(source[1]?.[1]) || 0;
  const share = (v: number) => (first ? `（${Math.round((v / first) * 1000) / 10}%）` : "");
  return {
    ...BASE,
    grid: { right: LABEL_ROOM * 1.6 },
    tooltip: { trigger: "axis", valueFormatter: fmt },
    dataset: { source },
    xAxis: { type: "value", axisLabel: { formatter: fmt } },
    yAxis: { type: "category", inverse: true },
    series: [{
      type: "bar",
      encode: { y: 0, x: 1 },
      label: {
        show: true,
        position: "right",
        formatter: (p: { value: unknown }) => {
          const v = (p.value as unknown[])[1];
          return v == null ? "无数据" : `${fmt(v)}${share(Number(v))}`;
        },
      },
    }],
  };
}

const escapeHtml = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 色阶最深只到中等蓝，格内文字统一用深色：ECharts 自动反白会让同一张图黑白字混排 */
const HEAT_COLORS = ["#eef1fb", "#8ea3e3"];
const HEAT_TEXT = "#1f2329";

/** 宽表转 heatmap 所需的 [列, 行, 值] 长表；null 不出格（D6：无数据不画成 0） */
export function heatmapOption(
  source: Source,
  opts: { format?: Format; max?: number; rowHint?: (row: string) => string | undefined } = {},
): EChartsOption {
  const fmt = formatter(opts.format);
  const cellText = opts.format === "pct" ? (v: unknown) => `${Number(v).toFixed(1)}%` : fmt;
  const [head = [], ...rows] = source;
  const cells: [string, string, number][] = [];
  for (const r of rows) {
    head.slice(1).forEach((col, i) => {
      const v = finite(r[i + 1]);
      if (v != null) cells.push([String(col), String(r[0]), v]);
    });
  }
  const values = cells.map((c) => c[2]);
  const min = Math.min(0, ...values);
  const max = opts.max ?? (values.length ? Math.max(...values) : 0);
  return {
    ...BASE,
    grid: { top: 56, bottom: 8 },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const { marker, value } = p as { marker: string; value: unknown[] };
        const row = String(value[1]);
        const hint = opts.rowHint?.(row);
        return `${escapeHtml(dayLabel(row))}${hint ? `　${escapeHtml(hint)}` : ""}`
          + `<br>${marker}${escapeHtml(value[0])}　<b>${escapeHtml(cellText(value[2]))}</b>`;
      },
    },
    dataset: { source: [["x", "y", "v"], ...cells] },
    xAxis: { type: "category", position: "top", data: head.slice(1).map(String) },
    yAxis: { type: "category", inverse: true, data: rows.map((r) => String(r[0])), axisLabel: { formatter: dayLabel } },
    visualMap: { show: false, min, max, inRange: { color: HEAT_COLORS } },
    series: [{
      type: "heatmap",
      encode: { x: 0, y: 1, value: 2 },
      label: { show: true, color: HEAT_TEXT, formatter: (p: { value: unknown }) => cellText((p.value as unknown[])[2]) },
      labelLayout: { hideOverlap: true },
    }],
  };
}
