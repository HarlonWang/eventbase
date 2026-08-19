import { Hono } from "hono";
import { dayOf } from "./time.js";

export interface QueryConfig<TEnv> {
  db: (env: TEnv) => D1Database;
  /** 挂载前缀，如 `/t/q` → 索引在 `/t/q`、指标在 `/t/q/m/:metric`。见 IngestConfig.basePath */
  basePath?: string;
  /** 未配置则整个取数面不挂载：宁可 404，也不要一个没有门的读接口 */
  adminToken: (env: TEnv) => string | undefined;
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_RANGE_DAYS = 14;
const MAX_RETENTION_N = 90;

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
  const prefix = config.basePath ?? "";
  const app = new Hono<{ Bindings: TEnv }>().basePath(prefix);
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
        // 带上前缀：索引是给机器读的自描述，路径不对就等于没有
        metric: `GET ${prefix}/m/:metric?from=YYYY-MM-DD&to=YYYY-MM-DD&by=<slice>&name=<event>&n=<days>`,
        sql: `POST ${prefix}/sql  { "sql": "SELECT ..." } — 只读单条 SELECT/WITH`,
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

    const raw = c.req.query("n");
    const n = raw === undefined ? 1 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_RETENTION_N) {
      return c.json({ error: `n must be an integer in 0..${MAX_RETENTION_N}` }, 400);
    }

    const built = build(key, { from, to, by: by as Slice | undefined, name: c.req.query("name"), n });

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
        // 换行不可省：调用方 SQL 末尾的 -- 注释会把收尾括号和 LIMIT 一起吃掉
        .prepare(`SELECT * FROM (${sql}\n) LIMIT ${maxRows + 1}`)
        .all();
    } catch (e) {
      return c.json({ error: `invalid sql: ${(e as Error).message}` }, 400);
    }

    const truncated = result.results.length > maxRows;
    return c.json({ rows: truncated ? result.results.slice(0, maxRows) : result.results, truncated });
  });

  return app;
}

const ALLOWED_TABLES = new Set([
  "events",
  "install_first_seen",
  "install_identity",
  "daily_rollup",
  "dim_identity_daily",
  "ingest_quota",
]);

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum)\b/i;
const BANNED_CALLS = /\b(load_extension|randomblob|zeroblob)\s*\(/i;

/**
 * 所有检查只看**骨架**——剥掉字符串字面量与注释后的 SQL。护栏清单见 docs/protocol.md：
 * 表名走白名单（`sqlite_master` 自然出局），不往关键词黑名单继续加词。
 */
function rejectUnsafe(sql: string): string | null {
  if (!sql) return "sql is required";

  const skeleton = skeletonOf(sql);
  if (skeleton.includes(";")) return "only a single statement is allowed";
  if (!/^\s*(select|with)\b/i.test(skeleton)) return "only SELECT / WITH is allowed";
  if (WRITE_KEYWORDS.test(skeleton)) return "write statements are not allowed";
  if (/\brecursive\b/i.test(skeleton)) return "recursive CTE is not allowed";

  const call = BANNED_CALLS.exec(skeleton);
  if (call) return `function not allowed: ${call[1].toLowerCase()}`;

  // SQLite 不要求 RECURSIVE 关键字（2026-08-19 实测），递归只能靠「CTE 体里 FROM 了自己」认
  const defined = ctes(skeleton);
  for (const cte of defined) {
    if (referencedTables(cte.body).includes(cte.name)) return "recursive CTE is not allowed";
  }

  const names = new Set(defined.map((cte) => cte.name));
  for (const table of referencedTables(skeleton)) {
    if (!ALLOWED_TABLES.has(table) && !names.has(table)) return `table not allowed: ${table}`;
  }
  return null;
}

/** 把字符串字面量与两种注释换成空白，位置无关的关键词检查才不会被它们骗到。 */
function skeletonOf(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] !== "'") i++;
        else if (sql[i + 1] === "'") i += 2;
        else {
          i++;
          break;
        }
      }
      out += " ";
    } else if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
    } else if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

const IDENTIFIER = String.raw`([A-Za-z_][A-Za-z0-9_$]*|"[^"]+"|\`[^\`]+\`|\[[^\]]+\])`;
const CTE_HEAD = new RegExp(
  String.raw`(?:\bwith\b|,)\s*` +
    IDENTIFIER +
    String.raw`\s*(?:\([^()]*\))?\s*\bas\b\s*(?:\bnot\s+)?(?:\bmaterialized\b\s*)?\(`,
  "gi"
);
const TABLE_REF = new RegExp(
  String.raw`\b(?:from|join)\s+` + IDENTIFIER + String.raw`(?:\s*\.\s*` + IDENTIFIER + String.raw`)?`,
  "gi"
);

/** `main.events` 取点号后一段：限定名既不能绕过白名单，也不该被误杀。 */
function referencedTables(skeleton: string): string[] {
  return [...skeleton.matchAll(TABLE_REF)].map((m) => unquote(m[2] ?? m[1]));
}

function ctes(skeleton: string): { name: string; body: string }[] {
  return [...skeleton.matchAll(CTE_HEAD)].map((m) => ({
    name: unquote(m[1]),
    body: balanced(skeleton, m.index + m[0].length - 1),
  }));
}

function balanced(sql: string, open: number): string {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i);
  }
  return sql.slice(open + 1);
}

function unquote(raw: string): string {
  const bare = /^["`[]/.test(raw) ? raw.slice(1, -1) : raw;
  return bare.toLowerCase();
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
        params: [args.n, args.from, args.to],
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
