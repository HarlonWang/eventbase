import { Hono } from "hono";
import type { IngestConfig } from "./config.js";
import { geoOf } from "./geo.js";
import { LIMITS } from "./limits.js";
import { eventStatements, firstSeenStatement, identityStatement, quotaStatement, readQuota } from "./store.js";
import { dayOf } from "./time.js";
import { normalizeEvent, parseBatch } from "./validate.js";

/**
 * 摄取端。**成功路径恒 204**，不区分「已入库」与「已丢弃」——客户端收到 204 即出队，
 * 不重试。4xx 同样出队（服务端已判定无效），只有 5xx 与网络错误才该重试。
 */
export function createIngest<TEnv extends object>(config: IngestConfig<TEnv>) {
  const app = new Hono<{ Bindings: TEnv }>();

  app.post("/e", async (c) => {
    const env = c.env as TEnv;

    const keys = config.appKeys?.(env);
    if (keys && !keys.includes(c.req.header("App-Key") ?? "")) {
      return c.json({ error: "unknown app key" }, 401);
    }

    const body = await c.req.text();
    if (new TextEncoder().encode(body).length > LIMITS.bodyBytes) {
      return c.json({ error: "body too large" }, 413);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const batch = parseBatch(raw);
    if ("status" in batch) return c.json({ error: batch.message }, batch.status);

    const limiter = config.limiter?.(env);
    if (limiter && !(await limiter.limit({ key: batch.install })).success) {
      return c.body(null, 204);
    }

    const now = Date.now();
    const events = batch.events
      .map((e) => normalizeEvent(e, now, config.allowedEvents))
      .filter((e) => e !== null);
    if (events.length === 0) return c.body(null, 204);

    const db = config.db(env);
    if (await overQuota(db, config, batch.install, now)) return c.body(null, 204);

    const ctx = { batch, geo: geoOf(c.req.raw), receivedAt: now };
    const statements = [
      ...eventStatements(db, events, ctx),
      firstSeenStatement(db, events, ctx),
      identityStatement(db, ctx),
      ...quotaStatements(db, config, batch.install, events.length, now),
    ].filter((s) => s !== null);

    await db.batch(statements);
    return c.body(null, 204);
  });

  return app;
}

/** 只读判断，记账跟着事件写入走同一个 batch：触顶的那一批放行一次，下一批才拦。 */
async function overQuota<TEnv extends object>(
  db: D1Database,
  config: IngestConfig<TEnv>,
  install: string,
  now: number
): Promise<boolean> {
  const quotas = config.quotas;
  if (!quotas) return false;

  const day = dayOf(now);
  if (quotas.perInstallPerDay !== undefined) {
    if ((await readQuota(db, day, `install:${install}`)) >= quotas.perInstallPerDay) return true;
  }
  if (quotas.totalPerDay !== undefined) {
    if ((await readQuota(db, day, "total")) >= quotas.totalPerDay) return true;
  }
  return false;
}

function quotaStatements<TEnv extends object>(
  db: D1Database,
  config: IngestConfig<TEnv>,
  install: string,
  n: number,
  now: number
): D1PreparedStatement[] {
  const quotas = config.quotas;
  if (!quotas) return [];

  const day = dayOf(now);
  const out: D1PreparedStatement[] = [];
  if (quotas.perInstallPerDay !== undefined) out.push(quotaStatement(db, day, `install:${install}`, n));
  if (quotas.totalPerDay !== undefined) out.push(quotaStatement(db, day, "total", n));
  return out;
}
