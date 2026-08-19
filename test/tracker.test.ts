import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTracker, flushEvents } from "../src/index";
import { initDb, rows, wipeDb } from "./helpers";

const request = new Request("https://api.example.com/api/checkout");

beforeAll(initDb);
beforeEach(wipeDb);

describe("服务端事件", () => {
  it("写同一张表，source=server", async () => {
    createTracker(env.DB)({ request }, { name: "checkout_step", userId: "u-1", props: { step: "completed" } });
    await flushEvents();

    const [row] = await rows();
    expect(row.name).toBe("checkout_step");
    expect(row.source).toBe("server");
    expect(row.user_id).toBe("u-1");
    expect(row.platform).toBe("server");
    expect(row.install_id).toBeNull();
    expect(JSON.parse(row.props!)).toEqual({ step: "completed" });
  });

  it("带 flow_id 时可与客户端事件串成同一条漏斗", async () => {
    createTracker(env.DB)({ request }, { name: "auth_finished", flowId: "flow-1" });
    await flushEvents();
    expect((await rows())[0].flow_id).toBe("flow-1");
  });

  it("表不存在也不抛——埋点绝不能成为业务的故障源", async () => {
    await env.DB.prepare("DROP TABLE events").run();
    try {
      expect(() => createTracker(env.DB)({ request }, { name: "quota_blocked" })).not.toThrow();
      await flushEvents();
    } finally {
      await initDb();
    }
  });

  it("配了 onError 才回调，且整个进程只回调一次", async () => {
    const seen: unknown[] = [];
    const track = createTracker(env.DB, { onError: (e) => seen.push(e) });
    await env.DB.prepare("DROP TABLE events").run();
    try {
      track({ request }, { name: "quota_blocked" });
      track({ request }, { name: "quota_blocked" });
      await flushEvents();
    } finally {
      await initDb();
    }
    expect(seen).toHaveLength(1);
  });

  it("waitUntil 存在时把写入挂上去", async () => {
    const promises: Promise<unknown>[] = [];
    createTracker(env.DB)(
      { request, waitUntil: (p) => promises.push(p) },
      { name: "subscription_action" }
    );
    expect(promises).toHaveLength(1);
    await flushEvents();
  });
});
