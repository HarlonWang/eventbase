import { Hono } from "hono";
import { dayOf } from "./time.js";

export interface QueryConfig<TEnv> {
  db: (env: TEnv) => D1Database;
  /** 未配置则整个取数面不挂载：宁可 404，也不要一个没有门的读接口 */
  adminToken: (env: TEnv) => string | undefined;
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_RANGE_DAYS = 14;

const SLICE_COLUMNS = ["channel", "platform", "app_version", "sys_locale", "country"] as const;
type Slice = (typeof SLICE_COLUMNS)[number];

const METRICS = {
  active: "当日活跃 install 去重数",
  new_installs: "安装日为当天的 install 数",
  events: "事件条数，按事件名拆",
  retention: "按安装日队列的第 N 日回访率（参数 n，默认 1）",
} as const;

/** events / retention 的 dim 位分别被事件名与队列占用，见 docs/protocol.md */
const METRIC_SLICES: Record<keyof typeof METRICS, readonly Slice[]> = {
  active: SLICE_COLUMNS,
  new_installs: SLICE_COLUMNS,
  events: [],
  retention: [],
};

export function createQuery<TEnv extends object>(config: QueryConfig<TEnv>) {
  const app = new Hono<{ Bindings: TEnv }>();
  const maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;

  app.use("*", async (c, next) => {
    const expected = config.adminToken(c.env as TEnv);
    if (!expected) return c.notFound();
    if (!timingSafeEqual(c.req.header("Authorization") ?? "", `Bearer ${expected}`)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.get("/", (c) =>
    c.json({
      metrics: METRICS,
      slices: SLICE_COLUMNS,
      usage: {
        metric: "GET /m/:metric?from=YYYY-MM-DD&to=YYYY-MM-DD&by=<slice>&name=<event>&n=<days>",
        sql: "POST /sql  { \"sql\": \"SELECT ...\" } — 只读单条 SELECT/WITH",
        defaults: { range: `${DEFAULT_RANGE_DAYS} 天`, maxRows },
      },
    })
  );

  app.get("/m/:metric", async (c) => {
    const metric = c.req.param("metric");
    if (!Object.hasOwn(METRICS, metric)) return c.json({ error: `unknown metric: ${metric}` }, 400);
    const key = metric as keyof typeof METRICS;

    const to = c.req.query("to") ?? dayOf(Date.now());
    if (!isDay(to)) return c.json({ error: `invalid to: ${to}` }, 400);
    const from = c.req.query("from") ?? shiftDay(to, -DEFAULT_RANGE_DAYS);
    if (!isDay(from)) return c.json({ error: `invalid from: ${from}` }, 400);

    const by = c.req.query("by");
    if (by && !SLICE_COLUMNS.includes(by as Slice)) {
      return c.json({ error: `unknown slice: ${by}` }, 400);
    }
    if (by && !METRIC_SLICES[key].includes(by as Slice)) {
      return c.json({ error: `metric ${key} does not support by=${by}` }, 400);
    }

    const built = build(key, {
      from,
      to,
      by: by as Slice | undefined,
      name: c.req.query("name"),
      n: Number(c.req.query("n") ?? 1),
    });

    let result;
    try {
      result = await config
        .db(c.env as TEnv)
        .prepare(built.sql)
        .bind(...built.params)
        .all();
    } catch (e) {
      return c.json({ error: `query failed: ${(e as Error).message}` }, 500);
    }

    return c.json({ metric, from, to, by: by ?? null, rows: result.results });
  });

  app.post("/sql", async (c) => {
    const body = await c.req.json<{ sql?: unknown }>().catch(() => ({ sql: undefined }));
    const sql = typeof body.sql === "string" ? body.sql.trim().replace(/;$/, "") : "";
    const rejection = rejectUnsafe(sql);
    if (rejection) return c.json({ error: rejection }, 400);

    let result;
    try {
      result = await config
        .db(c.env as TEnv)
        .prepare(`SELECT * FROM (${sql}) LIMIT ${maxRows + 1}`)
        .all();
    } catch (e) {
      return c.json({ error: `invalid sql: ${(e as Error).message}` }, 400);
    }

    const truncated = result.results.length > maxRows;
    return c.json({ rows: truncated ? result.results.slice(0, maxRows) : result.results, truncated });
  });

  return app;
}

/** 写操作与多语句一律拒绝。这个端点只连埋点库，即使被绕过也读不到业务库。 */
function rejectUnsafe(sql: string): string | null {
  if (!sql) return "sql is required";
  if (sql.includes(";")) return "only a single statement is allowed";
  if (!/^\s*(select|with)\b/i.test(sql)) return "only SELECT / WITH is allowed";
  const banned = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum)\b/i;
  if (banned.test(sql)) return "write statements are not allowed";
  return null;
}

interface Args {
  from: string;
  to: string;
  by?: Slice;
  name?: string;
  n: number;
}

function build(metric: keyof typeof METRICS, args: Args): { sql: string; params: unknown[] } {
  const dim = args.by ? `, ${args.by} AS dim` : "";
  const groupDim = args.by ? ", dim" : "";

  switch (metric) {
    case "active":
      return {
        sql: `SELECT day, COUNT(DISTINCT install_id) AS value${dim}
              FROM events
              WHERE day BETWEEN ? AND ? AND source = 'client' AND is_debug = 0
              GROUP BY day${groupDim} ORDER BY day`,
        params: [args.from, args.to],
      };

    case "new_installs":
      return {
        sql: `SELECT first_day AS day, COUNT(*) AS value${dim}
              FROM install_first_seen
              WHERE first_day BETWEEN ? AND ?
              GROUP BY first_day${groupDim} ORDER BY day`,
        params: [args.from, args.to],
      };

    case "events":
      return {
        sql: `SELECT day, name AS dim, COUNT(*) AS value
              FROM events
              WHERE day BETWEEN ? AND ? AND is_debug = 0 AND (? IS NULL OR name = ?)
              GROUP BY day, name ORDER BY day, name`,
        params: [args.from, args.to, args.name ?? null, args.name ?? null],
      };

    case "retention":
      return {
        sql: `SELECT f.first_day AS day,
                     COUNT(DISTINCT f.install_id) AS cohort,
                     COUNT(DISTINCT CASE WHEN e.day = date(f.first_day, '+' || ? || ' day')
                                         THEN e.install_id END) AS retained
              FROM install_first_seen f
              LEFT JOIN events e ON e.install_id = f.install_id
                                AND e.source = 'client' AND e.is_debug = 0
              WHERE f.first_day BETWEEN ? AND ?
              GROUP BY f.first_day ORDER BY day`,
        params: [Number.isFinite(args.n) ? args.n : 1, args.from, args.to],
      };

    default:
      throw new Error(`unhandled metric: ${metric satisfies never}`);
  }
}

function isDay(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

function shiftDay(day: string, delta: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000 - 8 * 3_600_000);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
