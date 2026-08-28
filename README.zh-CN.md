# eventbase

> 跑在 Cloudflare Workers 上的自建埋点——强类型事件、批量摄取，以及一个能被脚本调用的取数接口。

[English](README.md) | **简体中文**

[![npm](https://img.shields.io/npm/v/@whlong/eventbase)](https://www.npmjs.com/package/@whlong/eventbase)
[![license](https://img.shields.io/npm/l/@whlong/eventbase)](LICENSE)

eventbase 挂进你已经在跑的 Worker。事件落在**你自己的** D1 里，再通过一个 HTTP 接口读回来——脚本能调，语言模型也能直接调。没有需要注册的托管服务。客户端那一半是 Kotlin Multiplatform 库 [eventbase-kt](https://github.com/HarlonWang/eventbase-kt)。

## 为什么

**为让 AI 直接读取而设计。** 取数端点用 JSON 自描述——有哪些指标、支持哪些切片、每个参数长什么样——并直接接受只读 SQL。把 Claude 或一个定时任务指过去，分析就从「人坐下来做的事」变成「按时自己跑、自己出报告的事」。

**埋点绝不能成为业务的故障源。** 这是自建管道最容易搞砸的一件事。所有写入都走 `waitUntil` 并吞掉自己的异常，摄取端即便拒绝或丢弃整批也照样回 `204`——客户端因此永远不会把服务端的问题误当成「该一直重试」的信号。

## 能力

- **事件之上有一个取数接口。** 五个预置指标（`active`、`new_installs`、`events`、`retention`、`drops`）在 `GET /q/m/:metric`，只读 SQL 在 `POST /q/sql`，都由 admin token 守着。索引端点用 JSON 自描述整个取数面，agent 不用读文档就能发现该怎么问。**没配 token 则整个读接口不挂载**——宁可 404，也不要一个没有门的读接口。
- **丢失可归因。** 拒绝与丢弃按天按原因记进 `ingest_drops`，配合客户端的诊断日志，能把一条缺失的事件归因到三者之一：没 track、传丢了、服务端拒了。
- **你的 D1，你的数据。** 表结构随包分发，`migrations_dir` 指过去就行。什么都不出你的 Cloudflare 账号，也没有第三方替你保管用户行为。
- **服务端也能写事件。** `createTracker` 在你的 Worker 里写入，于是客户端观测不到的时刻——配额拦截、成单——落进同一张表，靠 `flow_id` 与客户端事件合流。
- **一个替你处理难点的客户端。** [eventbase-kt](https://github.com/HarlonWang/eventbase-kt) 负责离线队列、批量、退避重试与生命周期事件，且**不采集任何设备标识符**。

## 快速开始

**1. 安装。** Hono 作为 peer dependency 自动带上——库用它建路由；你的 Worker 若也在用 Hono，那就是同一份。

```bash
npm install @whlong/eventbase
```

**2. 执行迁移。** DDL 随包分发，升级包就带上新迁移。

```toml
# wrangler.toml
[[d1_databases]]
binding = "EVENTS_DB"
database_name = "my-app-events"
database_id = "..."
migrations_dir = "node_modules/@whlong/eventbase/migrations"
```

```bash
npx wrangler d1 migrations apply my-app-events --remote
```

**3. 挂载摄取与取数。** 两个工厂都返回 Hono app，裸 Workers handler 直接路由过去即可。

```ts
import { createIngest, createQuery } from "@whlong/eventbase";

const ingest = createIngest<Env>({
  db: (env) => env.EVENTS_DB,
  basePath: "/t",                                  // 摄取端点落在 /t/e
  appKeys: (env) => [env.EVENTBASE_KEY],           // 公开 key：用于路由与关停，不是鉴权
});

const query = createQuery<Env>({
  db: (env) => env.EVENTS_DB,
  basePath: "/t/q",
  adminToken: (env) => env.EVENTBASE_ADMIN_TOKEN,  // 不配则整个取数面不挂载
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/t/q")) return query.fetch(request, env, ctx);
    if (pathname.startsWith("/t")) return ingest.fetch(request, env, ctx);
    return yourApp.fetch(request, env, ctx);
  },
};
```

**4. 记录客户端看不见的事**（可选）。`createTracker` 不抛异常，也不阻塞响应。

```ts
const track = createTracker(env.EVENTS_DB);

track({ request, waitUntil: ctx.waitUntil.bind(ctx) }, {
  name: "quota_blocked",
  userId,
  flowId,                                    // 与客户端的 flow 合流
  props: { reason: "daily_limit" },
});
```

**5. 问一个问题。**

```bash
# 索引是自描述的：有哪些指标、哪些切片、参数长什么样
curl -H "Authorization: Bearer $TOKEN" https://your-worker.example.com/t/q

curl -H "Authorization: Bearer $TOKEN" \
  "https://your-worker.example.com/t/q/m/active?from=2026-08-01&by=platform"

curl -H "Authorization: Bearer $TOKEN" https://your-worker.example.com/t/q/sql \
  -d '{"sql":"select name, count(*) c from events group by 1 order by c desc"}'
```

**6. 接上你的 App。** 把 [eventbase-kt](https://github.com/HarlonWang/eventbase-kt) 指向 `https://your-worker.example.com/t`，入队、批量、重试都归它。

## 运行要求

Cloudflare Workers，带 D1 binding · `hono` ^4.12.8 · 一个会说[上报协议](docs/protocol.md)的客户端——eventbase-kt，或者你自己发的 HTTP 请求。

## 不包含什么

没有会话录制、没有 A/B 实验，也不存用户档案——eventbase 只记录事件，再把它们作为行返回给你。它不替你采集设备标识符或任何 PII，进表的就是你选择发送的。运行时是 Cloudflare Workers，存储是 D1。

## 文档

| | |
|---|---|
| [上报协议](docs/protocol.md) | wire 契约——两端的唯一权威 |
| [埋点设计](docs/telemetry-design.md) | 事件词汇、指标口径、四层模型 |
| [设计决策](docs/design.md) | 部署拓扑、接入形态、为什么拆两个仓 |

## License

MIT
