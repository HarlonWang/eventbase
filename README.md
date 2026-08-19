# eventbase

> Self-hosted app analytics for my apps — batched ingestion, typed events, SQL you can actually query.
> Cloudflare Workers + D1 server library, with a Kotlin Multiplatform client.

多 App 共用的埋点底座：客户端批量上报、服务端事件补发、明细落各 App 自己的 D1，取数走带 token 的 HTTP 接口。服务端库跑在各 App 自己的 Worker 里（数据在各自 D1，不做中心化服务），客户端库以 Kotlin Multiplatform 提供，住在姊妹仓 [HarlonWang/eventbase-kt](https://github.com/HarlonWang/eventbase-kt)。**协议契约 [docs/protocol.md](docs/protocol.md) 只住本仓，是两端的唯一权威。**

## 由来

替换 Aptabase。两个动因，第二个才是主因：

1. $10/月订阅；
2. **没有查询 API**——每次分析只能人肉导 CSV 再喂给 Claude，分析闭环无法自动化。

所以第一优先级不是省钱，是**一个能被脚本和 Claude 直接调用的取数接口**。看板 UI 明确不做。完整背景见 [docs/migration-from-aptabase.md](docs/migration-from-aptabase.md)。

## 结构（两个仓库：一份协议，两个产物）

```
eventbase/                   # 本仓：TS 服务端库 + 协议契约
├── src/                     # createIngest（摄取 + 取数端点）/ createTracker（服务端 writer）
├── migrations/              # 表结构随包分发，消费方 migrations_dir 指向 node_modules
├── queries/                 # 核心指标取数 SQL（人肉执行）
└── docs/
    ├── design.md            # 工程决策：拆库、单 Worker 起步、接入形态、仓库关系
    ├── telemetry-design.md  # L1~L4 分层定稿 + 事件词汇
    ├── protocol.md          # 上报协议（唯一权威）
    └── migration-from-aptabase.md

eventbase-kt/                # 姊妹仓：KMP 客户端库（独立版本线与 CI）
```

## 产物坐标

```
服务端仓     HarlonWang/eventbase          （含 protocol.md，协议唯一权威）
客户端仓     HarlonWang/eventbase-kt
npm         @whlong/eventbase
Maven       wang.harlon:eventbase-kt
Kotlin 包    wang.harlon.eventbase
```

npm 裸名 `eventbase` 被 2014 年的废弃包占用，已去信询问转让；未拿到前用 scoped 名。
scope 用 `@whlong`（npm 用户名，不是 GitHub handle）——scope 必须对应已存在的 npm 用户或组织。

**0.1.0 是本地手动发布的一次性例外**，没有对应 tag：`publish.yml` 由 tag 触发，
而 npm 侧的 trusted publisher 尚未配置，打 tag 只会留下一次注定失败的 CI 运行。
配好之后从下一个版本起走 CI 发布。

## 状态

**摄取端已实现**（2026-08-19），L1~L4 四层定稿见 `docs/telemetry-design.md`。落地顺序：

1. ✅ 服务端库：摄取端点（`createIngest`）、服务端 writer（`createTracker`）、取数端点（`createQuery`）、migration、限流/配额、丢弃计数、事件幂等 id——71 个测试。前缀由 `basePath` 传入，消费方无需自建 Hono
2. KMP 客户端库：install_id、批量、持久化队列、重试、生命周期事件
3. TrendingAI 接入：换掉 Aptabase + 按新词汇重构调用点
4. 取数 SQL 集
5. loginbase 改用本库（登录事件合表，`auth_events` 退役）

## 设计红线

- **依赖准入**：与 loginbase 同一套判据——现有基座、业界权威库（四条硬判据）、自己的库三类放行，其余先停下来问值不值
- **注释准入**：「为什么」写进 docs，「是什么」靠命名，注释只留「反直觉」。判据与量化护栏见 [CLAUDE.md](CLAUDE.md)
- **协议变更**：服务端实现 + `docs/protocol.md` 同一个 commit，并在 `eventbase-kt` 仓开跟进 issue
- **埋点绝不能成为业务的故障源**：服务端写入一律 `waitUntil` + 吞异常；摄取端恒返回 204
