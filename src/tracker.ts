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

export interface TrackerOptions {
  /** 写入失败时回调。**整个进程只回调一次**，避免故障期每个请求都触发；不配置则完全静默 */
  onError?: (error: unknown) => void;
}

const pending = new Set<Promise<unknown>>();
let warned = false;

/** 供测试等待异步写入；生产路径走 waitUntil。 */
export async function flushEvents(): Promise<void> {
  await Promise.allSettled([...pending]);
}

/**
 * 服务端事件不走 HTTP，直接写 D1。**返回的函数永不抛**——埋点绝不能成为业务的故障源，
 * 这条保证由库兑现，不摊派给每个调用点。写入 Promise 的 rejection 之外，
 * `prepare` / `waitUntil` / 缺 `request` 的同步抛出同样被接住。
 * 判据：漏斗末端落在业务库的，补发 server 事件，不靠跨库 JOIN。
 */
export function createTracker(db: D1Database, options: TrackerOptions = {}) {
  return (ctx: TrackContext, event: ServerEvent): void => {
    try {
      write(db, options, ctx, event);
    } catch (error) {
      report(options, error);
    }
  };
}

function write(
  db: D1Database,
  options: TrackerOptions,
  ctx: TrackContext,
  event: ServerEvent
): void {
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
      .catch((error: unknown) => report(options, error));

    const tracked = promise.finally(() => pending.delete(tracked));
    pending.add(tracked);
    ctx.waitUntil?.(tracked);
}

/** 整个进程只回调一次：故障期每个请求都触发回调，本身就会变成新的故障源 */
function report(options: TrackerOptions, error: unknown): void {
  if (warned || !options.onError) return;
  warned = true;
  try {
    options.onError(error);
  } catch {
    // 消费方的 onError 自己抛，同样不能外泄
  }
}
