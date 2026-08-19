import { env } from "cloudflare:workers";
import schema from "../migrations/0001_events.sql?raw";
import locale from "../migrations/0002_install_locale.sql?raw";
import drops from "../migrations/0003_ingest_drops.sql?raw";
import eventId from "../migrations/0004_event_id.sql?raw";
import { createIngest, createQuery } from "../src/index";

export async function initDb() {
  for (const stmt of [schema, locale, drops, eventId].join(";").split(";").filter((s) => s.trim())) {
    // ALTER TABLE ADD COLUMN 没有 IF NOT EXISTS，重复 initDb 时只能靠吞这一种错
    await env.DB.prepare(stmt)
      .run()
      .catch((e: Error) => {
        if (!/duplicate column name/.test(e.message)) throw e;
      });
  }
}

export async function wipeDb() {
  for (const table of ["events", "install_first_seen", "install_identity", "ingest_quota", "ingest_drops"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

export function ingest(overrides: Partial<Parameters<typeof createIngest>[0]> = {}) {
  return createIngest<Cloudflare.Env>({
    db: (e) => e.DB,
    ...overrides,
  } as Parameters<typeof createIngest<Cloudflare.Env>>[0]);
}

export function batch(overrides: Record<string, unknown> = {}) {
  return {
    install: "install-1",
    session: "session-1",
    sys: { version: "1.3.0", platform: "android", channel: "play", locale: "zh-Hans-CN" },
    events: [{ name: "app_opened", at: Date.now(), props: { is_cold: true } }],
    ...overrides,
  };
}

export function post(app: ReturnType<typeof ingest>, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/e", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }, env);
}

export interface EventRow {
  event_id: string | null;
  name: string;
  day: string;
  source: string;
  install_id: string | null;
  user_id: string | null;
  session_id: string | null;
  flow_id: string | null;
  app_version: string | null;
  platform: string | null;
  channel: string | null;
  sys_locale: string | null;
  is_debug: number;
  event_at: number;
  received_at: number;
  props: string | null;
}

export async function rows(): Promise<EventRow[]> {
  const result = await env.DB.prepare("SELECT * FROM events ORDER BY id").all<EventRow>();
  return result.results;
}

export function query(overrides: Record<string, unknown> = {}) {
  return createQuery<Cloudflare.Env>({
    db: (e) => e.DB,
    adminToken: () => "test-admin-token",
    ...overrides,
  } as Parameters<typeof createQuery<Cloudflare.Env>>[0]);
}

export function get(app: ReturnType<typeof query>, path: string, token = "test-admin-token") {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
}

export function sql(app: ReturnType<typeof query>, statement: string, token = "test-admin-token") {
  return app.request(
    "/sql",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: statement }),
    },
    env
  );
}

export async function seed(day: string, install: string, name = "app_opened", extra: Record<string, unknown> = {}) {
  const at = Date.parse(`${day}T04:00:00Z`);
  await env.DB.prepare(
    `INSERT INTO events (received_at, event_at, day, name, source, install_id, channel, platform, is_debug)
     VALUES (?, ?, ?, ?, 'client', ?, ?, ?, ?)`
  )
    .bind(at, at, day, name, install, extra.channel ?? "play", extra.platform ?? "android", extra.is_debug ?? 0)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO install_first_seen (install_id, first_day, channel, platform, sys_locale)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(install, day, extra.channel ?? "play", extra.platform ?? "android", extra.locale ?? "zh-Hans-CN")
    .run();
}
