import type { Geo } from "./geo.js";
import { dayOf } from "./time.js";
import type { IncomingBatch, NormalizedEvent } from "./validate.js";

export interface WriteContext {
  batch: IncomingBatch;
  geo: Geo;
  receivedAt: number;
}

export function eventStatements(
  db: D1Database,
  events: NormalizedEvent[],
  ctx: WriteContext
): D1PreparedStatement[] {
  const { batch, geo, receivedAt } = ctx;
  const insert = db.prepare(
    `INSERT INTO events
       (received_at, event_at, day, name, source, install_id, user_id, session_id, flow_id,
        app_version, platform, channel, sys_locale, country, asn, colo, timezone, is_debug, props)
     VALUES (?, ?, ?, ?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  return events.map((e) =>
    insert.bind(
      receivedAt,
      e.at,
      dayOf(e.at),
      e.name,
      batch.install,
      batch.user ?? null,
      batch.session,
      e.flow,
      batch.sys.version ?? null,
      batch.sys.platform ?? null,
      batch.sys.channel ?? null,
      batch.sys.locale ?? null,
      geo.country,
      geo.asn,
      geo.colo,
      geo.timezone,
      batch.sys.debug ? 1 : 0,
      e.props
    )
  );
}

/**
 * 安装日与首次归因冻结在此，避免「新增 install」去扫全历史求 min(day)。
 * debug 批不写：一台机器可能既跑 debug 又跑正式包，写了就永久钉死在队列表里。
 */
export function firstSeenStatement(
  db: D1Database,
  events: NormalizedEvent[],
  ctx: WriteContext
): D1PreparedStatement | null {
  const { batch, geo } = ctx;
  if (batch.sys.debug) return null;

  const firstDay = events.map((e) => dayOf(e.at)).reduce((a, b) => (a < b ? a : b));
  return db
    .prepare(
      `INSERT INTO install_first_seen
         (install_id, first_day, channel, app_version, platform, country, sys_locale)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(install_id) DO UPDATE
         SET first_day = MIN(install_first_seen.first_day, excluded.first_day)`
    )
    .bind(
      batch.install,
      firstDay,
      batch.sys.channel ?? null,
      batch.sys.version ?? null,
      batch.sys.platform ?? null,
      geo.country,
      batch.sys.locale ?? null
    );
}

export function identityStatement(db: D1Database, ctx: WriteContext): D1PreparedStatement | null {
  const { batch, receivedAt } = ctx;
  if (!batch.user) return null;
  return db
    .prepare(
      `INSERT INTO install_identity (install_id, user_id, first_seen, last_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(install_id, user_id) DO UPDATE SET last_seen = excluded.last_seen`
    )
    .bind(batch.install, batch.user, receivedAt, receivedAt);
}

/** 只读当日累计，不递增。记账由 quotaStatement 与事件写入同批完成。 */
export async function readQuota(db: D1Database, day: string, key: string): Promise<number> {
  const row = await db
    .prepare(`SELECT n FROM ingest_quota WHERE day = ? AND key = ?`)
    .bind(day, key)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function quotaStatement(
  db: D1Database,
  day: string,
  key: string,
  n: number
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ingest_quota (day, key, n) VALUES (?, ?, ?)
       ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n`
    )
    .bind(day, key, n);
}
