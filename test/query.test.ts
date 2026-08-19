import { env } from "cloudflare:workers";
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

describe("挂载前缀", () => {
  it("索引与指标都落在前缀下", async () => {
    const app = query({ basePath: "/t/q" });

    const index = await app.request("/t/q", { headers: { Authorization: "Bearer test-admin-token" } }, env);
    const metric = await app.request(
      "/t/q/m/active?from=2026-08-01&to=2026-08-31",
      { headers: { Authorization: "Bearer test-admin-token" } },
      env
    );

    expect(index.status).toBe(200);
    expect(metric.status).toBe(200);
  });

  /** 索引是给机器读的自描述：照它给的路径访问必须真能命中 */
  it("索引自描述的路径带上前缀", async () => {
    const app = query({ basePath: "/t/q" });
    const res = await app.request("/t/q", { headers: { Authorization: "Bearer test-admin-token" } }, env);
    const body = await res.json<{ usage: { metric: string; sql: string } }>();

    expect(body.usage.metric).toContain("/t/q/m/:metric");
    expect(body.usage.sql).toContain("/t/q/sql");
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

  it("原型链上的属性名不算指标", async () => {
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      expect((await get(query(), `/m/${name}`)).status).toBe(400);
    }
  });

  it("非法日期 400，不落到 D1", async () => {
    expect((await get(query(), "/m/active?to=nope")).status).toBe(400);
    expect((await get(query(), "/m/active?from=2026-13-45&to=2026-08-31")).status).toBe(400);
  });

  it("指标不支持的切片轴 400，而不是静默返回未切片的数", async () => {
    expect((await get(query(), "/m/retention?by=channel")).status).toBe(400);
    expect((await get(query(), "/m/events?by=channel")).status).toBe(400);
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

  it("new_installs 可按 sys_locale 切片——首见时冻结的 locale", async () => {
    await seed("2026-08-10", "a", "app_opened", { locale: "zh-Hans-CN" });
    await seed("2026-08-10", "b", "app_opened", { locale: "en-US" });

    const body = await (
      await get(query(), "/m/new_installs?from=2026-08-01&to=2026-08-31&by=sys_locale")
    ).json<{ rows: { dim: string }[] }>();
    expect(body.rows.map((r) => r.dim).sort()).toEqual(["en-US", "zh-Hans-CN"]);
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

  it("n 必须是 0..90 的整数", async () => {
    for (const n of ["1e12", "-1", "1.5", "nope", "91"]) {
      expect((await get(query(), `/m/retention?n=${n}`)).status).toBe(400);
    }
    expect((await get(query(), "/m/retention?n=0")).status).toBe(200);
    expect((await get(query(), "/m/retention?n=90")).status).toBe(200);
  });

  it("retention 的回访分子只认非 debug 的客户端事件", async () => {
    await seed("2026-08-10", "a");
    await seed("2026-08-11", "a", "app_opened", { is_debug: 1 });
    await seed("2026-08-10", "b");
    await env.DB.prepare(
      `INSERT INTO events (received_at, event_at, day, name, source, install_id, is_debug)
       VALUES (0, 0, '2026-08-11', 'checkout_completed', 'server', 'b', 0)`
    ).run();

    const body = await (
      await get(query(), "/m/retention?from=2026-08-01&to=2026-08-31&n=1")
    ).json<{ rows: { retained: number }[] }>();
    expect(body.rows[0].retained).toBe(0);
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

  it("字面量与注释里的关键词不再误杀正当查询", async () => {
    await seed("2026-08-10", "a");
    for (const statement of [
      "SELECT COUNT(*) AS n FROM events WHERE props LIKE '%update%'",
      "SELECT COUNT(*) AS n FROM events WHERE name = 'delete_account'",
      "SELECT COUNT(*) AS n FROM events -- insert 说明\n",
      "SELECT COUNT(*) AS n /* drop table events */ FROM events",
      "SELECT COUNT(*) AS n FROM events WHERE name LIKE '%;%'",
    ]) {
      expect([statement, (await sql(query(), statement)).status]).toEqual([statement, 200]);
    }
  });

  it("骨架剥离后，藏在字面量/注释里的语句仍拦得住真的写操作", async () => {
    expect((await sql(query(), "SELECT 1 /* x */; DELETE FROM events")).status).toBe(400);
  });

  it("表名白名单：元信息表读不到", async () => {
    for (const statement of [
      "SELECT sql FROM sqlite_master",
      'SELECT sql FROM "sqlite_master"',
      "SELECT * FROM pragma_table_info('events')",
      "SELECT * FROM events JOIN sqlite_master ON 1 = 1",
    ]) {
      expect((await sql(query(), statement)).status).toBe(400);
    }
  });

  it("递归 CTE 拒绝——省略 RECURSIVE 也拦得住", async () => {
    for (const bomb of [
      "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1e8) SELECT COUNT(*) FROM c",
      "WITH c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1e8) SELECT COUNT(*) FROM c",
      "WITH c AS (SELECT 1 AS x UNION ALL SELECT x + 1 FROM c WHERE x < 1e8) SELECT COUNT(*) FROM c",
    ]) {
      expect([bomb, (await sql(query(), bomb)).status]).toEqual([bomb, 400]);
    }
  });

  it("非递归的 CTE 写法不被误杀", async () => {
    for (const statement of [
      "WITH c(n) AS (SELECT 1) SELECT * FROM c",
      "WITH a AS (SELECT 1 AS n), b AS (SELECT * FROM a) SELECT * FROM b",
      "WITH a AS MATERIALIZED (SELECT 1 AS n) SELECT * FROM a",
      "WITH day AS (SELECT day FROM events) SELECT * FROM day",
    ]) {
      expect([statement, (await sql(query(), statement)).status]).toEqual([statement, 200]);
    }
  });

  it("schema 限定名：既不绕过白名单，也不被误杀", async () => {
    expect((await sql(query(), "SELECT COUNT(*) AS n FROM main.events")).status).toBe(200);
    expect((await sql(query(), "SELECT sql FROM main.sqlite_master")).status).toBe(400);
  });

  it("撑内存与加载扩展的函数拒绝", async () => {
    for (const statement of [
      "SELECT hex(randomblob(100000000))",
      "SELECT zeroblob(100000000)",
      "SELECT load_extension('x')",
    ]) {
      expect((await sql(query(), statement)).status).toBe(400);
    }
  });

  it("非白名单表拒绝，但 WITH 定义的 CTE 名照常放行", async () => {
    expect((await sql(query(), "SELECT * FROM secrets")).status).toBe(400);
    expect((await sql(query(), "WITH c AS (SELECT 1 AS n) SELECT * FROM c")).status).toBe(200);
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
