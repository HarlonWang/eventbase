import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, initDb, query, seed, sql, wipeDb } from "./helpers";

beforeAll(initDb);
beforeEach(wipeDb);

describe("鉴权", () => {
  it("token 不对 401", async () => {
    expect((await get(query(), "/", "wrong")).status).toBe(401);
  });

  it("未配置 adminToken 时整个取数面 404", async () => {
    const app = query({ adminToken: () => undefined });
    expect((await get(app, "/")).status).toBe(404);
  });

  it("索引自描述：列出指标、切片轴与用法", async () => {
    const res = await get(query(), "/");
    const body = await res.json<{ metrics: Record<string, string>; slices: string[] }>();
    expect(Object.keys(body.metrics)).toContain("retention");
    expect(body.slices).toContain("channel");
  });
});

describe("指标", () => {
  it("active 按天去重 install", async () => {
    await seed("2026-08-10", "a");
    await seed("2026-08-10", "a", "screen_viewed");
    await seed("2026-08-10", "b");
    await seed("2026-08-11", "a");

    const res = await get(query(), "/m/active?from=2026-08-01&to=2026-08-31");
    const body = await res.json<{ rows: { day: string; value: number }[] }>();
    expect(body.rows).toEqual([
      { day: "2026-08-10", value: 2 },
      { day: "2026-08-11", value: 1 },
    ]);
  });

  it("active 剔除 debug 流量", async () => {
    await seed("2026-08-10", "a");
    await seed("2026-08-10", "dbg", "app_opened", { is_debug: 1 });

    const body = await (await get(query(), "/m/active?from=2026-08-01&to=2026-08-31")).json<{
      rows: { value: number }[];
    }>();
    expect(body.rows[0].value).toBe(1);
  });

  it("by 切片按渠道拆", async () => {
    await seed("2026-08-10", "a", "app_opened", { channel: "play" });
    await seed("2026-08-10", "b", "app_opened", { channel: "fdroid" });

    const body = await (await get(query(), "/m/active?from=2026-08-01&to=2026-08-31&by=channel")).json<{
      rows: { dim: string; value: number }[];
    }>();
    expect(body.rows.map((r) => r.dim).sort()).toEqual(["fdroid", "play"]);
  });

  it("未登记的切片轴 400", async () => {
    expect((await get(query(), "/m/active?by=install_id")).status).toBe(400);
  });

  it("未知指标 400", async () => {
    expect((await get(query(), "/m/nope")).status).toBe(400);
  });

  it("new_installs 数安装日", async () => {
    await seed("2026-08-10", "a");
    await seed("2026-08-11", "a");
    await seed("2026-08-11", "b");

    const body = await (await get(query(), "/m/new_installs?from=2026-08-01&to=2026-08-31")).json<{
      rows: { day: string; value: number }[];
    }>();
    expect(body.rows).toEqual([
      { day: "2026-08-10", value: 1 },
      { day: "2026-08-11", value: 1 },
    ]);
  });

  it("events 按事件名拆，可按 name 过滤", async () => {
    await seed("2026-08-10", "a", "content_opened");
    await seed("2026-08-10", "b", "content_opened");
    await seed("2026-08-10", "a", "app_opened");

    const body = await (
      await get(query(), "/m/events?from=2026-08-01&to=2026-08-31&name=content_opened")
    ).json<{ rows: { dim: string; value: number }[] }>();
    expect(body.rows).toEqual([{ day: "2026-08-10", dim: "content_opened", value: 2 }]);
  });

  it("retention 按安装日队列算次日回访", async () => {
    await seed("2026-08-10", "a");
    await seed("2026-08-11", "a");
    await seed("2026-08-10", "b");

    const body = await (
      await get(query(), "/m/retention?from=2026-08-01&to=2026-08-31&n=1")
    ).json<{ rows: { day: string; cohort: number; retained: number }[] }>();
    expect(body.rows).toEqual([{ day: "2026-08-10", cohort: 2, retained: 1 }]);
  });
});

describe("受限 SQL", () => {
  it("SELECT 放行", async () => {
    await seed("2026-08-10", "a");
    const body = await (await sql(query(), "SELECT COUNT(*) AS n FROM events")).json<{
      rows: { n: number }[];
    }>();
    expect(body.rows[0].n).toBe(1);
  });

  it("WITH 放行", async () => {
    await seed("2026-08-10", "a");
    const res = await sql(query(), "WITH x AS (SELECT 1 AS n) SELECT * FROM x");
    expect(res.status).toBe(200);
  });

  it("写语句一律拒绝", async () => {
    for (const statement of [
      "DELETE FROM events",
      "UPDATE events SET name = 'x'",
      "DROP TABLE events",
      "INSERT INTO events (day) VALUES ('x')",
      "PRAGMA table_list",
    ]) {
      expect((await sql(query(), statement)).status).toBe(400);
    }
  });

  it("多语句拒绝——防夹带写操作", async () => {
    expect((await sql(query(), "SELECT 1; DELETE FROM events")).status).toBe(400);
  });

  it("超过 maxRows 时截断并标记", async () => {
    for (const i of [1, 2, 3]) await seed("2026-08-10", `i${i}`);

    const body = await (await sql(query({ maxRows: 2 }), "SELECT * FROM events")).json<{
      rows: unknown[];
      truncated: boolean;
    }>();
    expect(body.rows).toHaveLength(2);
    expect(body.truncated).toBe(true);
  });
});
