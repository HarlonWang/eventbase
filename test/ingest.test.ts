import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { batch, ingest, initDb, post, rows, wipeDb } from "./helpers";

beforeAll(initDb);
beforeEach(wipeDb);

describe("摄取", () => {
  it("正常批量落库，携带 sys 与 props", async () => {
    const res = await post(ingest(), batch());
    expect(res.status).toBe(204);

    const [row] = await rows();
    expect(row.name).toBe("app_opened");
    expect(row.source).toBe("client");
    expect(row.install_id).toBe("install-1");
    expect(row.session_id).toBe("session-1");
    expect(row.app_version).toBe("1.3.0");
    expect(row.platform).toBe("android");
    expect(row.channel).toBe("play");
    expect(row.sys_locale).toBe("zh-Hans-CN");
    expect(JSON.parse(row.props!)).toEqual({ is_cold: true });
  });

  it("events 里的非对象条目只丢那条，不把整批打成 500", async () => {
    const res = await post(
      ingest(),
      batch({ events: [null, "x", 1, { name: "app_opened", at: Date.now() }] })
    );
    expect(res.status).toBe(204);
    expect((await rows()).map((r) => r.name)).toEqual(["app_opened"]);
  });

  it("单条无效只丢那条，其余照收", async () => {
    const now = Date.now();
    await post(
      ingest(),
      batch({
        events: [
          { name: "app_opened", at: now },
          { name: "Bad Name", at: now },
          { name: "screen_viewed", at: now },
          { name: "x".repeat(61), at: now },
        ],
      })
    );
    expect((await rows()).map((r) => r.name)).toEqual(["app_opened", "screen_viewed"]);
  });

  it("超出时间窗的事件被丢弃", async () => {
    const now = Date.now();
    await post(
      ingest(),
      batch({
        events: [
          { name: "too_new", at: now + 11 * 60 * 1000 },
          { name: "too_old", at: now - 8 * 24 * 60 * 60 * 1000 },
          { name: "just_ok", at: now - 6 * 24 * 60 * 60 * 1000 },
        ],
      })
    );
    expect((await rows()).map((r) => r.name)).toEqual(["just_ok"]);
  });

  it("props 截断长字符串、丢弃超量键与非标量值", async () => {
    const props: Record<string, unknown> = { long: "x".repeat(300), nested: { a: 1 }, list: [1] };
    for (let i = 0; i < 25; i++) props[`k${i}`] = i;

    await post(ingest(), batch({ events: [{ name: "content_opened", at: Date.now(), props }] }));

    const parsed = JSON.parse((await rows())[0].props!) as Record<string, unknown>;
    expect((parsed.long as string).length).toBe(180);
    expect(parsed.nested).toBeUndefined();
    expect(parsed.list).toBeUndefined();
    expect(Object.keys(parsed).length).toBe(20);
  });

  it("day 按 UTC+8 日界计算，不是 UTC", async () => {
    const at = Date.parse("2026-08-18T16:30:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(at);
    try {
      await post(ingest(), batch({ events: [{ name: "app_opened", at }] }));
    } finally {
      vi.useRealTimers();
    }

    expect((await rows())[0].day).toBe("2026-08-19");
  });

  it("received_at 是服务端时间，与客户端 event_at 分开存", async () => {
    const at = Date.now() - 60 * 60 * 1000;
    await post(ingest(), batch({ events: [{ name: "app_opened", at }] }));

    const [row] = await rows();
    expect(row.event_at).toBe(at);
    expect(row.received_at).toBeGreaterThan(at);
  });

  it("白名单开启后，未登记的事件名被丢弃", async () => {
    await post(
      ingest({ allowedEvents: ["app_opened"] }),
      batch({ events: [{ name: "app_opened" }, { name: "unknown_event" }] })
    );
    expect((await rows()).map((r) => r.name)).toEqual(["app_opened"]);
  });
});

describe("批级拒绝", () => {
  it("事件数超上限整批 400", async () => {
    const events = Array.from({ length: 26 }, () => ({ name: "app_opened" }));
    const res = await post(ingest(), batch({ events }));
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("body 超上限 413", async () => {
    const res = await post(
      ingest(),
      batch({ events: [{ name: "app_opened", props: { pad: "x".repeat(70_000) } }] })
    );
    expect(res.status).toBe(413);
  });

  it("缺 install 或 session 一律 400", async () => {
    expect((await post(ingest(), batch({ install: undefined }))).status).toBe(400);
    expect((await post(ingest(), batch({ session: undefined }))).status).toBe(400);
  });

  it("非法 JSON 400", async () => {
    expect((await post(ingest(), "{not json")).status).toBe(400);
  });

  it("App-Key 不匹配 401；匹配则放行", async () => {
    const app = ingest({ appKeys: () => ["good-key"] });
    expect((await post(app, batch(), { "App-Key": "bad" })).status).toBe(401);
    expect((await post(app, batch(), { "App-Key": "good-key" })).status).toBe(204);
  });
});

describe("限流与配额", () => {
  it("限流命中返回 204 且不落库", async () => {
    const limiter = { limit: async () => ({ success: false }) };
    const res = await post(ingest({ limiter: () => limiter }), batch());
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it("超出单 install 日配额后丢弃，仍返回 204", async () => {
    const app = ingest({ quotas: { perInstallPerDay: 2 } });
    await post(app, batch({ events: [{ name: "app_opened" }, { name: "app_opened" }] }));
    const res = await post(app, batch());

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(2);
  });

  it("全局日配额独立于单 install 配额", async () => {
    const app = ingest({ quotas: { totalPerDay: 1 } });
    await post(app, batch({ install: "a" }));
    await post(app, batch({ install: "b" }));

    expect(await rows()).toHaveLength(1);
  });
});

describe("辅助表", () => {
  it("first_day 取批内最小的事件日，不是收包时间", async () => {
    const now = Date.parse("2026-08-19T04:00:00Z");
    const earlier = Date.parse("2026-08-17T20:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await post(
        ingest(),
        batch({
          events: [
            { name: "app_opened", at: now },
            { name: "screen_viewed", at: earlier },
          ],
        })
      );
    } finally {
      vi.useRealTimers();
    }

    const row = await env.DB.prepare("SELECT first_day FROM install_first_seen").first<{
      first_day: string;
    }>();
    expect(row!.first_day).toBe("2026-08-18");
  });

  it("debug 批不进 install_first_seen——留存分母不含 QA 机器", async () => {
    await post(
      ingest(),
      batch({ sys: { version: "1.3.0", platform: "android", channel: "play", debug: true } })
    );

    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM install_first_seen").first<{
      n: number;
    }>();
    expect(row!.n).toBe(0);
    expect(await rows()).toHaveLength(1);
  });

  it("sys_locale 冻结在 install_first_seen", async () => {
    await post(ingest(), batch());
    const row = await env.DB.prepare("SELECT sys_locale FROM install_first_seen").first<{
      sys_locale: string;
    }>();
    expect(row!.sys_locale).toBe("zh-Hans-CN");
  });

  it("install_first_seen 只记首次，归因维度冻结", async () => {
    const app = ingest();
    await post(app, batch());
    await post(app, batch({ sys: { version: "9.9.9", platform: "android", channel: "fdroid" } }));

    const row = await env.DB.prepare("SELECT * FROM install_first_seen").first<{
      app_version: string;
      channel: string;
    }>();
    expect(row?.app_version).toBe("1.3.0");
    expect(row?.channel).toBe("play");
  });

  it("带 user 时写 install_identity，重复上报只更新 last_seen", async () => {
    const app = ingest();
    await post(app, batch({ user: "identity-1" }));
    await post(app, batch({ user: "identity-1" }));

    const result = await env.DB.prepare("SELECT * FROM install_identity").all<{
      first_seen: number;
      last_seen: number;
    }>();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].last_seen).toBeGreaterThanOrEqual(result.results[0].first_seen);
  });

  it("匿名上报不写 install_identity", async () => {
    await post(ingest(), batch());
    const result = await env.DB.prepare("SELECT * FROM install_identity").all();
    expect(result.results).toHaveLength(0);
  });
});

describe("挂载前缀", () => {
  it("带 basePath 时端点在前缀下", async () => {
    const app = ingest({ basePath: "/t" });
    const res = await app.request(
      "/t/e",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch()) },
      env
    );

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(1);
  });

  it("带 basePath 后裸路径不再命中——消费方不必自建 Hono 做嫁接", async () => {
    const res = await post(ingest({ basePath: "/t" }), batch());

    expect(res.status).toBe(404);
  });
});

describe("事件幂等 id", () => {
  it("客户端带来的 id 原样落库", async () => {
    await post(ingest(), batch({ events: [{ name: "app_opened", id: "11111111-2222-3333-4444-555555555555" }] }));

    const row = await env.DB.prepare("SELECT event_id FROM events").first<{ event_id: string }>();
    expect(row?.event_id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("没带 id 也照收——旧客户端不能因此被拒", async () => {
    const res = await post(ingest(), batch());

    expect(res.status).toBe(204);
    const row = await env.DB.prepare("SELECT event_id FROM events").first<{ event_id: string | null }>();
    expect(row?.event_id).toBeNull();
  });

  it("超长 id 截断而不是丢弃整条", async () => {
    await post(ingest(), batch({ events: [{ name: "app_opened", id: "x".repeat(80) }] }));

    const row = await env.DB.prepare("SELECT event_id FROM events").first<{ event_id: string }>();
    expect(row?.event_id.length).toBe(36);
  });

  it("重复 id 当前照收——先观察重复率，不建唯一索引", async () => {
    const app = ingest();
    await post(app, batch({ events: [{ name: "app_opened", id: "dup" }] }));
    await post(app, batch({ events: [{ name: "app_opened", id: "dup" }] }));

    expect(await rows()).toHaveLength(2);
  });
});

describe("丢弃计数", () => {
  async function drops(): Promise<Record<string, number>> {
    const result = await env.DB.prepare("SELECT reason, n FROM ingest_drops").all<{ reason: string; n: number }>();
    return Object.fromEntries(result.results.map((r) => [r.reason, r.n]));
  }

  it("按原因分别累加：格式非法、过期、未来", async () => {
    const now = Date.now();
    await post(
      ingest(),
      batch({
        events: [
          { name: "app_opened", at: now },
          { name: "Bad Name", at: now },
          { name: "too_old", at: now - 8 * 24 * 60 * 60 * 1000 },
          { name: "too_new", at: now + 11 * 60 * 1000 },
        ],
      })
    );

    expect(await drops()).toEqual({ invalid: 1, expired: 1, future: 1 });
    expect(await rows()).toHaveLength(1);
  });

  it("白名单外的事件单独计一类", async () => {
    await post(
      ingest({ allowedEvents: ["app_opened"] }),
      batch({ events: [{ name: "app_opened" }, { name: "unknown_event" }] })
    );

    expect(await drops()).toEqual({ unknown_event: 1 });
  });

  it("整批都无效时也记账", async () => {
    await post(ingest(), batch({ events: [{ name: "Bad" }, { name: "Also Bad" }] }));

    expect(await drops()).toEqual({ invalid: 2 });
    expect(await rows()).toHaveLength(0);
  });

  it("配额触顶记 quota，且不落事件", async () => {
    const app = ingest({ quotas: { perInstallPerDay: 1 } });
    await post(app, batch());
    await post(app, batch({ events: [{ name: "app_opened" }, { name: "screen_viewed" }] }));

    expect((await drops()).quota).toBe(2);
    expect(await rows()).toHaveLength(1);
  });

  it("配额触顶且批内混有无效事件时，同一事件不被记两次", async () => {
    const app = ingest({ quotas: { perInstallPerDay: 1 } });
    await post(app, batch());
    await post(app, batch({ events: [{ name: "app_opened" }, { name: "Bad Name" }] }));

    const d = await drops();
    expect(d.quota).toBe(1);
    expect(d.invalid).toBe(1);
  });

  it("限流丢弃刻意不记账——那条路径必须保持零 D1", async () => {
    const limiter = { limit: async () => ({ success: false }) };
    await post(ingest({ limiter: () => limiter }), batch());

    expect(await drops()).toEqual({});
  });

  it("多次请求在同一天累加到同一行", async () => {
    await post(ingest(), batch({ events: [{ name: "Bad" }] }));
    await post(ingest(), batch({ events: [{ name: "Bad" }] }));

    expect((await drops()).invalid).toBe(2);
  });
});
