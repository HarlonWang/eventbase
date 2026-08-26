import { EVENT_NAME_RE, LIMITS } from "./limits.js";

export interface IncomingSys {
  version?: string;
  platform?: string;
  channel?: string;
  locale?: string;
  debug?: boolean;
}

export interface IncomingEvent {
  id?: unknown;
  name?: unknown;
  at?: unknown;
  flow?: unknown;
  props?: unknown;
}

export interface IncomingBatch {
  install: string;
  session: string;
  user?: string;
  device?: string;
  sys: IncomingSys;
  events: IncomingEvent[];
}

export interface NormalizedEvent {
  id: string | null;
  name: string;
  at: number;
  flow: string | null;
  props: string | null;
}

export type BatchError = { status: 400; message: string };

/** 丢弃原因，落 ingest_drops 用 */
export type DropReason = "invalid" | "expired" | "future" | "unknown_event";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

export function parseBatch(raw: unknown): IncomingBatch | BatchError {
  if (!isRecord(raw)) return { status: 400, message: "body must be an object" };

  const install = str(raw.install);
  const session = str(raw.session);
  if (!install) return { status: 400, message: "install is required" };
  if (!session) return { status: 400, message: "session is required" };

  if (!Array.isArray(raw.events)) return { status: 400, message: "events must be an array" };
  if (raw.events.length > LIMITS.batchEvents) {
    return { status: 400, message: `too many events (max ${LIMITS.batchEvents})` };
  }

  const sysRaw = isRecord(raw.sys) ? raw.sys : {};
  return {
    install,
    session,
    user: str(raw.user),
    // 超长截断而非丢批：设备标识对不上账事小，整批事件丢了事大
    device: str(raw.device)?.slice(0, LIMITS.deviceChars),
    sys: {
      version: str(sysRaw.version),
      platform: str(sysRaw.platform),
      channel: str(sysRaw.channel),
      locale: str(sysRaw.locale),
      debug: sysRaw.debug === true,
    },
    events: raw.events as IncomingEvent[],
  };
}

/** 单条无效只丢那条，其余照收。返回 null 即丢弃。 */
export function normalizeEvent(
  event: IncomingEvent,
  now: number,
  allowed?: readonly string[]
): NormalizedEvent | DropReason {
  if (!isRecord(event)) return "invalid";
  const name = str(event.name);
  if (!name || name.length > LIMITS.eventName || !EVENT_NAME_RE.test(name)) return "invalid";
  if (allowed && !allowed.includes(name)) return "unknown_event";

  const at = typeof event.at === "number" && Number.isFinite(event.at) ? event.at : now;
  if (at > now + LIMITS.futureMs) return "future";
  if (at < now - LIMITS.pastMs) return "expired";

  return {
    id: str(event.id)?.slice(0, LIMITS.eventIdChars) ?? null,
    name,
    at,
    flow: str(event.flow) ?? null,
    props: normalizeProps(event.props),
  };
}

function normalizeProps(raw: unknown): string | null {
  if (!isRecord(raw)) return null;

  const out: Record<string, string | number | boolean> = {};
  let keys = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (keys >= LIMITS.propKeys) break;
    if (!key || key.length > LIMITS.propKeyChars) continue;
    if (typeof value === "string") out[key] = value.slice(0, LIMITS.propValueChars);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else continue;
    keys++;
  }
  return keys > 0 ? JSON.stringify(out) : null;
}
