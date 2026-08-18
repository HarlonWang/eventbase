import { geoOf } from "./geo.js";
import { dayOf } from "./time.js";

export interface ServerEvent {
  name: string;
  userId?: string;
  installId?: string;
  flowId?: string;
  props?: Record<string, unknown>;
}

export interface TrackContext {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const pending = new Set<Promise<unknown>>();

/** 供测试等待异步写入；生产路径走 waitUntil。 */
export async function flushEvents(): Promise<void> {
  await Promise.allSettled([...pending]);
}

/**
 * 服务端事件不走 HTTP，直接写 D1。写入失败一律吞掉——埋点绝不能成为业务的故障源。
 * 判据：漏斗末端落在业务库的，补发 server 事件，不靠跨库 JOIN。
 */
export function createTracker(db: D1Database) {
  return (ctx: TrackContext, event: ServerEvent): void => {
    const now = Date.now();
    const geo = geoOf(ctx.request);
    const promise = db
      .prepare(
        `INSERT INTO events
           (received_at, event_at, day, name, source, install_id, user_id, flow_id,
            platform, country, asn, colo, timezone, props)
         VALUES (?, ?, ?, ?, 'server', ?, ?, ?, 'server', ?, ?, ?, ?, ?)`
      )
      .bind(
        now,
        now,
        dayOf(now),
        event.name,
        event.installId ?? null,
        event.userId ?? null,
        event.flowId ?? null,
        geo.country,
        geo.asn,
        geo.colo,
        geo.timezone,
        event.props ? JSON.stringify(event.props) : null
      )
      .run()
      .catch(() => undefined);

    const tracked = promise.finally(() => pending.delete(tracked));
    pending.add(tracked);
    ctx.waitUntil?.(tracked);
  };
}
