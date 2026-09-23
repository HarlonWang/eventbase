import type { EChartsOption, SeriesOption } from "echarts";
import { formatter, type Format } from "./format.js";
import type { Source } from "./types.js";

const BASE: EChartsOption = {
  aria: { enabled: true },
  backgroundColor: "transparent",
  toolbox: { feature: { dataView: { readOnly: true }, saveAsImage: {} } },
};

/** 柱末端数值标签不在 outerBounds 的避让范围内，右侧要手动留白 */
const LABEL_ROOM = 56;

const seriesCount = (source: Source) => Math.max(0, (source[0]?.length ?? 1) - 1);

const rowTotal = (row: Source[number]) =>
  row.slice(1).reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);

export function lineOption(source: Source, opts: { format?: Format; yMax?: number } = {}): EChartsOption {
  const fmt = formatter(opts.format);
  const n = seriesCount(source);
  return {
    ...BASE,
    legend: { show: n > 1 },
    tooltip: { trigger: "axis", valueFormatter: fmt },
    dataset: { source },
    xAxis: { type: "category", axisLabel: { formatter: (d: string) => d.slice(5) } },
    yAxis: { type: "value", max: opts.yMax, axisLabel: { formatter: fmt } },
    series: Array.from({ length: n }, (): SeriesOption => ({ type: "line" })),
  };
}

/** 按行合计降序，保留前 topN 行，其余逐列求和并成一行 */
export function mergeTail(source: Source, topN: number, otherLabel = "其他"): Source {
  const [head, ...rows] = source;
  const sorted = [...rows].sort((a, b) => rowTotal(b) - rowTotal(a));
  if (sorted.length <= topN) return [head, ...sorted];
  const tail = sorted.slice(topN);
  const other = head.slice(1).map((_, i) =>
    tail.reduce<number>((a, r) => a + (typeof r[i + 1] === "number" ? (r[i + 1] as number) : 0), 0));
  return [head, ...sorted.slice(0, topN), [`${otherLabel}（${tail.length}）`, ...other]];
}

export function barOption(
  source: Source,
  opts: { format?: Format; horizontal?: boolean; stack?: boolean; topN?: number; otherLabel?: string } = {},
): EChartsOption {
  const fmt = formatter(opts.format);
  const n = seriesCount(source);
  const data = opts.horizontal && opts.topN ? mergeTail(source, opts.topN, opts.otherLabel) : source;
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
      : { xAxis: { type: "category", axisLabel: { formatter: (d: string) => (/^\d{4}-\d\d-\d\d$/.test(d) ? d.slice(5) : d) } }, yAxis: valueAxis }),
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
