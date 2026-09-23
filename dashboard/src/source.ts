import type { Source, TableData } from "./types.js";

const rowTotal = (row: Source[number]) =>
  row.slice(1).reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);

/** 按行合计降序，表头不动 */
export function sortByTotal(source: Source): Source {
  const [head, ...rows] = source;
  return head ? [head, ...[...rows].sort((a, b) => rowTotal(b) - rowTotal(a))] : source;
}

/** 按行合计降序，保留前 topN 行，其余逐列求和并成一行 */
export function mergeTail(source: Source, topN: number, otherLabel = "其他"): Source {
  const [head, ...sorted] = sortByTotal(source);
  const n = Math.max(0, Math.floor(topN));
  if (sorted.length <= n) return [head, ...sorted];
  const tail = sorted.slice(n);
  const other = head.slice(1).map((_, i) =>
    tail.reduce<number>((a, r) => a + (typeof r[i + 1] === "number" ? (r[i + 1] as number) : 0), 0));
  return [head, ...sorted.slice(0, n), [`${otherLabel}（${tail.length}）`, ...other]];
}

export type Triple = [row: string | number, col: string | number, value: unknown];

export interface Pivot {
  data: TableData;
  /** 与 data.rows 同形；0~1 为着色深浅，null 不着色（首列、合计、无数据格） */
  heat: (number | null)[][];
}

/** 数值与数值字符串转成有限数；其余类型、空串、NaN、±Infinity 视为无数据 */
export const finite = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 长表透视成二维表；同一格重复出现时累加，缺失组合留 null，不补 0 */
export function pivot(
  triples: Triple[],
  opts: { corner?: string; totals?: boolean; order?: "total" | "input"; totalLabel?: string } = {},
): Pivot {
  const cells = new Map<string, Map<string, number>>();
  const colSet = new Set<string>();
  const rowSum = new Map<string, number>(), colSum = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const [r, c, raw] of triples) {
    const v = finite(raw);
    const row = String(r), col = String(c);
    if (!cells.has(row)) cells.set(row, new Map());
    colSet.add(col);
    if (v == null) continue;
    add(cells.get(row)!, col, v);
    add(rowSum, row, v);
    add(colSum, col, v);
  }
  const byTotal = (sums: Map<string, number>) => (a: string, b: string) => (sums.get(b) ?? 0) - (sums.get(a) ?? 0);
  const rows = [...cells.keys()], cols = [...colSet];
  if (opts.order !== "input") {
    rows.sort(byTotal(rowSum));
    cols.sort(byTotal(colSum));
  }
  const totals = opts.totals ?? true;
  const label = opts.totalLabel ?? "合计";
  const peak = Math.max(0, ...rows.flatMap((r) => [...cells.get(r)!.values()]));
  const shade = (v: number | undefined) => (v == null || peak === 0 ? null : Math.max(0, v) / peak);

  const body: TableData["rows"] = [], heat: (number | null)[][] = [];
  for (const r of rows) {
    const line = cells.get(r)!;
    body.push([r, ...cols.map((c) => line.get(c) ?? null), ...(totals ? [rowSum.get(r) ?? null] : [])]);
    heat.push([null, ...cols.map((c) => shade(line.get(c))), ...(totals ? [null] : [])]);
  }
  if (totals && rows.length) {
    const grand = [...rowSum.values()].reduce((a, v) => a + v, 0);
    body.push([label, ...cols.map((c) => colSum.get(c) ?? null), rowSum.size ? grand : null]);
    heat.push(body[body.length - 1].map(() => null));
  }
  const columns = [opts.corner ?? "", ...cols, ...(totals ? [label] : [])].map((c, i) => (i ? { label: c, num: true } : c));
  return { data: { columns, rows: body }, heat };
}
