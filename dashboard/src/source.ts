import type { Source } from "./types.js";

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
