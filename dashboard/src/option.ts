import type { EChartsOption, SeriesOption } from "echarts";
import { formatter, type Format } from "./format.js";
import { mergeTail, sortByTotal } from "./source.js";
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

const ROW_PX = 24;

const escapeHtml = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 行数多时卡片随之加高，保证每格可读 */
export const heatmapHeight = (source: Source): number => Math.max(300, (source.length - 1) * ROW_PX + 140);

/** 宽表转 heatmap 所需的 [列, 行, 值] 长表；null 不出格（D6：无数据不画成 0） */
export function heatmapOption(source: Source, opts: { format?: Format; max?: number } = {}): EChartsOption {
  const fmt = formatter(opts.format);
  const [head = [], ...rows] = source;
  const cells: (string | number)[][] = [];
  for (const r of rows) {
    head.slice(1).forEach((col, i) => {
      const v = r[i + 1];
      if (typeof v === "number") cells.push([String(col), String(r[0]), v]);
    });
  }
  const max = opts.max ?? Math.max(0, ...cells.map((c) => c[2] as number));
  return {
    ...BASE,
    grid: { top: 56, bottom: 56 },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const { marker, value } = p as { marker: string; value: unknown[] };
        return `${escapeHtml(value[1])}<br>${marker}${escapeHtml(value[0])}　<b>${escapeHtml(fmt(value[2]))}</b>`;
      },
    },
    dataset: { source: [["x", "y", "v"], ...cells] },
    xAxis: { type: "category", position: "top", data: head.slice(1).map(String), splitArea: { show: true } },
    yAxis: { type: "category", inverse: true, data: rows.map((r) => String(r[0])), axisLabel: { formatter: dayLabel } },
    visualMap: {
      min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0,
      formatter: (v: unknown) => fmt(v),
    },
    series: [{
      type: "heatmap",
      encode: { x: 0, y: 1, value: 2 },
      label: { show: true, formatter: (p: { value: unknown }) => fmt((p.value as unknown[])[2]) },
      labelLayout: { hideOverlap: true },
    }],
  };
}
