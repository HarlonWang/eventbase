# eventbase

> Self-hosted app analytics for Cloudflare Workers — typed events, batched ingestion, and a query API you can script.

**English** | [简体中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/@whlong/eventbase)](https://www.npmjs.com/package/@whlong/eventbase)
[![license](https://img.shields.io/npm/l/@whlong/eventbase)](LICENSE)

eventbase mounts into a Worker you already run. Events land in **your** D1, and you read them back over an HTTP endpoint that scripts — and language models — can call directly. There is no hosted service to sign up for. The client half is [eventbase-kt](https://github.com/HarlonWang/eventbase-kt), a Kotlin Multiplatform library.

## Why

**Built to be read by an agent.** The query endpoint describes itself in JSON — the metrics it offers, the slices they accept, the shape of every parameter — and takes read-only SQL directly. Point Claude or a cron job at it and analysis becomes something that runs on a schedule and writes its own report, rather than something a person sits down to do.

**Analytics must never take the product down.** This is the one thing an in-house pipeline reliably gets wrong. Every write goes through `waitUntil` and swallows its own exceptions, and the ingestion endpoint answers `204` even when it rejects or drops the batch — so a client can never mistake a server problem for a reason to retry forever.

## What you get

- **A query API over your own events.** Five prebuilt metrics (`active`, `new_installs`, `events`, `retention`, `drops`) at `GET /q/m/:metric`, and read-only SQL at `POST /q/sql`, both behind an admin token. The index endpoint describes the whole surface in JSON, so an agent can discover what to ask without reading these docs. No token configured means the read surface never mounts — better a 404 than a door without a lock.
- **Loss is accountable.** Rejected and dropped batches are counted by day and reason in `ingest_drops`. Together with the client's diagnostic log, that pins a missing event on one of three causes: never tracked, lost in transit, or refused by the server.
- **Your D1, your data.** Table definitions ship inside the package; point `migrations_dir` at it and you're done. Nothing leaves your Cloudflare account, and there is no third party to trust with user behaviour.
- **Server-side events too.** `createTracker` writes from inside your Worker, so the moments a client can't observe — a quota rejection, a completed payment — land in the same table and join up with client events through `flow_id`.
- **A client that handles the hard parts.** [eventbase-kt](https://github.com/HarlonWang/eventbase-kt) gives you an offline queue, batching, backoff and lifecycle events, and it collects no device identifiers at all.

## Quick start

**1. Install.** Hono comes along as a peer dependency — the library builds its routes with it, and if your Worker already uses Hono, that stays the single copy.

```bash
npm install @whlong/eventbase
```

**2. Apply the migrations.** The package ships its own DDL, so upgrading it brings new migrations with it.

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

**3. Mount ingestion and querying.** Both factories return a Hono app, so a plain Workers handler can route to them directly.

```ts
import { createIngest, createQuery } from "@whlong/eventbase";

const ingest = createIngest<Env>({
  db: (env) => env.EVENTS_DB,
  basePath: "/t",                                  // ingestion lands on /t/e
  appKeys: (env) => [env.EVENTBASE_KEY],           // public key: routing and kill-switch, not auth
});

const query = createQuery<Env>({
  db: (env) => env.EVENTS_DB,
  basePath: "/t/q",
  adminToken: (env) => env.EVENTBASE_ADMIN_TOKEN,  // omit it and the read surface never mounts
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

**4. Record what the client can't see** (optional). `createTracker` never throws and never blocks the response.

```ts
const track = createTracker(env.EVENTS_DB);

track({ request, waitUntil: ctx.waitUntil.bind(ctx) }, {
  name: "quota_blocked",
  userId,
  flowId,                                    // joins up with the client's flow
  props: { reason: "daily_limit" },
});
```

**5. Ask a question.**

```bash
# the index is self-describing: available metrics, slices, and parameter shapes
curl -H "Authorization: Bearer $TOKEN" https://your-worker.example.com/t/q

curl -H "Authorization: Bearer $TOKEN" \
  "https://your-worker.example.com/t/q/m/active?from=2026-08-01&by=platform"

curl -H "Authorization: Bearer $TOKEN" https://your-worker.example.com/t/q/sql \
  -d '{"sql":"select name, count(*) c from events group by 1 order by c desc"}'
```

**6. Connect your app.** Point [eventbase-kt](https://github.com/HarlonWang/eventbase-kt) at `https://your-worker.example.com/t` and it owns queueing, batching and retries from there.

## Requirements

Cloudflare Workers with a D1 binding · `hono` ^4.12.8 · a client that speaks the [ingestion protocol](docs/protocol.md) — eventbase-kt, or your own HTTP call.

## Not included

No session replay, no A/B testing, and no user profile store — eventbase records events and hands them back as rows. It does not collect device identifiers or any PII on your behalf; what reaches the table is what you chose to send. The runtime is Cloudflare Workers and the store is D1.

## Documentation

| | |
|---|---|
| [Ingestion protocol](docs/protocol.md) | The wire contract — single source of truth for both halves |
| [Telemetry design](docs/telemetry-design.md) | Event vocabulary, metric definitions, the four-layer model |
| [Design decisions](docs/design.md) | Deployment topology, integration shapes, why the repos are split |

## License

MIT
