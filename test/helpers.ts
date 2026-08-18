import { env } from "cloudflare:workers";
import schema from "../migrations/0001_events.sql?raw";
import { createIngest } from "../src/index";

export async function initDb() {
  for (const stmt of schema.split(";").filter((s) => s.trim())) {
    await env.DB.prepare(stmt).run();
  }
}

export async function wipeDb() {
  for (const table of ["events", "install_first_seen", "install_identity", "ingest_quota"]) {
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
