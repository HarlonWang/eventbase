import type { Row } from "./types.js";

/** 同一批次内 SQL 文本相同只请求一次；每个调用方拿到各自的数组副本，排序等原地操作互不影响 */
export function memoize(run: (sql: string) => Promise<Row[]>): (sql: string) => Promise<Row[]> {
  const inflight = new Map<string, Promise<Row[]>>();
  return (sql) => {
    let p = inflight.get(sql);
    if (!p) {
      p = run(sql);
      inflight.set(sql, p);
    }
    return p.then((rows) => rows.slice());
  };
}
