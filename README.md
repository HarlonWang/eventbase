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

**0.1.x 目前是本地手动发布**，没有对应 tag：`publish.yml` 由 tag 触发，
而 npm 侧的 trusted publisher 尚未配置，打 tag 只会留下一次注定失败的 CI 运行。
配好之后从下一个版本起走 CI 发布。

⚠️ **0.1.2 是坏的，别用**——它打包了一份陈旧 `dist`（表白名单其实没被移除）。
根因是 `npm publish` 不会构建，而那次发布前 dist 停留在更早的 commit。
0.1.3 起 `prepublishOnly` 会强制 typecheck + build + test，这条路径已堵死。

## 状态

**服务端已上线并在生产验证**（2026-08-19）。L1~L4 四层定稿见 `docs/telemetry-design.md`。落地顺序：

1. ✅ 服务端库：摄取（`createIngest`）、服务端 writer（`createTracker`）、取数（`createQuery`）、migration、限流/配额、丢弃计数、事件幂等 id——75 个测试。前缀由 `basePath` 传入，消费方无需自建 Hono
   - ✅ **已部署**：D1 `trending-events`（APAC，0001~0004 已应用）；`api.trendingai.cn/t/e` 摄取、`/t/q` 取数；生产七项复验全过（丢弃读数、元信息放开、只读底线、递归 CTE 熔断、字符串不误杀）
2. ✅ KMP 客户端库（`eventbase-kt`）：install_id、批量、落盘队列、重试、生命周期事件、诊断日志、幂等 id、install_id 种子——45 个测试，Android + iOS 两端编译通过
3. 🟡 **TrendingAI 接入**：composite build 已接、`platformTrackEvent` 与 Aptabase 已删、89 个调用点按 §12.9 重构完毕（词汇随之补出第 20 个事件 `notification_delivery`，见 §12.9 末尾的四处修正）；`installId` 种子参数为此加进 `EventbaseConfig`（客户端与服务端补发事件必须同一个 install_id）。
   - ✅ eventbase-kt 0.1.0 已发 Maven Central（2026-08-20），TrendingAI 已用纯 Maven 坐标验证构建通过
   - ⬜ 待办：真机演练（断网 5 下 / 杀进程 / 旋转屏幕，用 `adb logcat -s eventbase:D` 与取数接口三处对账）
   - ⬜ 待办：隐私政策与 Play 数据安全表单改采集方（第三方 Aptabase → 自有服务，见 13.1）
4. ⬜ 取数 SQL 集与对账（`chat_logs` 残差、Aptabase 并行期量级、事件覆盖差集）
5. ⬜ loginbase 改用本库（登录事件合表，`auth_events` 退役）

**发布**：`publishConfig.provenance = false` —— provenance **不支持私有仓**（官方原话：private repository 即使发公开包也不行），而 trusted publishing 默认会自动生成 provenance，不关掉的话 CI 发布会卡在那一步。仓库转 public 后应把这行删掉，provenance 是白拿的安全属性。

**遗留运维项**：npm trusted publisher 未配（发布仍靠手动 + OTP）；`0.1.2` 是坏版本待 deprecate；生产库里有一条冒烟数据（`channel='smoke'`），分析时排除。

## 设计红线

- **依赖准入**：与 loginbase 同一套判据——现有基座、业界权威库（四条硬判据）、自己的库三类放行，其余先停下来问值不值
- **注释准入**：「为什么」写进 docs，「是什么」靠命名，注释只留「反直觉」。判据与量化护栏见 [CLAUDE.md](CLAUDE.md)
- **协议变更**：服务端实现 + `docs/protocol.md` 同一个 commit，并在 `eventbase-kt` 仓开跟进 issue
- **埋点绝不能成为业务的故障源**：服务端写入一律 `waitUntil` + 吞异常；摄取端恒返回 204
