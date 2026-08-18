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

/** 安装日与首次归因冻结在此，避免「新增 install」去扫全历史求 min(day)。 */
export function firstSeenStatement(db: D1Database, ctx: WriteContext): D1PreparedStatement {
  const { batch, geo, receivedAt } = ctx;
  return db
    .prepare(
      `INSERT OR IGNORE INTO install_first_seen
         (install_id, first_day, channel, app_version, platform, country)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      batch.install,
      dayOf(receivedAt),
      batch.sys.channel ?? null,
      batch.sys.version ?? null,
      batch.sys.platform ?? null,
      geo.country
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

/**
 * 先计数后写入，返回累计值。限流绑定按 colo 局部计数，跨 colo 的日配额只能落在这里。
 * 超限时事件已被计入但不落库——宁可多计，不做「先读后写」的两次往返。
 */
export async function bumpQuota(
  db: D1Database,
  day: string,
  key: string,
  n: number
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO ingest_quota (day, key, n) VALUES (?, ?, ?)
       ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n
       RETURNING n`
    )
    .bind(day, key, n)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
