# eventbase 工程决策

拓扑、接入形态、仓库关系。**这些是与 L3 并行拍板的工程决策**，不属 `telemetry-design.md` 的分层讨论。

> **编号说明**：本文的章节编号沿用调研原稿（2026-08-18 拆分入库），跨文件引用共用同一套编号：
>
> | 章节 | 所在文件 |
> |---|---|
> | §1 动机、§3 容量测算、§8 迁移面、§9 阶段与成本 | `docs/migration-from-aptabase.md`（数字在 `trendingai-notes.md`） |
> | §2 决策、§4 存储与部署拓扑、§5 接入形态、§6 仓库关系 | `docs/design.md` |
> | §7 摄取端滥用面、§10~§14（L1~L4 与待议） | `docs/telemetry-design.md` |
> | 两端契约 | `docs/protocol.md` |

---

## 2. 已拍板（2026-08-18）

| # | 决策 | 说明 |
|---|---|---|
| 1 | **形态照搬 loginbase**：npm 服务端库（Hono sub-app）+ KMP 客户端库（姊妹仓）+ 协议文档住服务端仓 | 不做中心化服务 |
| 2 | **数据落各 App 自己的 D1** | 与 loginbase「不做中心化账号」一致；跨 App 对比靠手工拼，接受 |
| 3 | **与 loginbase 的 `auth_events` 合表**：新库统管一张事件表，登录事件也进来 | 否则登录漏斗的服务端段与客户端段永远拼不起来（loginbase 待议清单里「客户端事件与服务端事件同表 ✅」已是同一结论） |
| 4 | **loginbase 把本库列为 peerDependency**，直接调本库的 writer，消费方零接线 | 同日一并改判 loginbase 的「依赖最小集」铁律为「依赖准入」（业界权威库 + 自己的库可依赖），原先被铁律逼出的配置注入绕法随之取消 |
| 5 | **埋点独立一个 D1 库**（`trending-events`，binding `EVENTS_DB`），与业务库分开 | D1 每库单线程，埋点洪水与分析慢查询会抢业务的执行队列；付费档拆库零边际成本。**这是唯一不可逆的一项**，故先定。详见第 4 节 |
| 6 | **单 Worker 起步**：摄取端挂在现有业务 Worker 上（路径 `/t/*`），不另建 Worker | 性能影响实质为零，而两 Worker 方案的成本大头是**不可版本化的控制台配置**，会被 App 数量乘起来。拆分是**可逆**的将来项，判据见 4.5 |

### 决策 4 的展开（2026-08-18 改判）

- 表的归属权归本库，migration 由本库分发；
- loginbase 把本库声明为 **peerDependency**（同它对 hono 的处理），版本由消费方决定——自己的库在信任维度更高，但版本维度风险反而更大：写成普通 dependency 时，消费方 Worker 里可能同时存在 loginbase 拖来的一份和自己直装的一份，两份各写各的表；
- 消费方把 loginbase 的 `stats.enabled` 置 false，`auth_events` 退役。存量自 2026-08-17 才开始写，量极小，迁移或直接弃用都不痛；
- 敢让两库绑演进节奏的前提是**埋点写入本就是 fail-safe**（`waitUntil` 异步 + 吞掉一切异常），故障不会传导到登录。

**被否的原方案**（旧铁律下的唯一出路）：loginbase 加一个可选 `stats.sink` 配置项，消费方在自己的 Worker 里手工把 writer 注入进去。否掉的理由是这段接线正是「容易漏配又静默失效」的典型——loginbase 自己已经吃过一次同类：消费方升级了包但没跑 migration，统计静默不落库。而它在安全上并无收益：那是自己的库、同样走 trusted publishing 发布。

铁律改判的完整记录见 loginbase 的 `docs/design.md`「依赖准入」一节（README / CLAUDE.md 的红线条目已同步）。

## 4. 存储与部署拓扑（2026-08-18 定）

### 4.1 拆的理由（付费档下与配额无关）

D1 文档原话：**每个数据库本身是单线程的，一次只处理一个查询**（毫秒级查询约 1000 QPS，100ms 查询只剩约 10 QPS）。埋点洪水、以及我们自己要跑的留存/漏斗**全表扫描慢查询**，都会和登录/订阅/chat 抢同一个库的执行队列——这是延迟层面的干扰，日常就存在，不只被攻击时才有。

付费档可建 5 万个库、D1 只按用量计费，多一个库不额外收钱，成本上没有不拆的理由。

### 4.2 拆完之后，哪些真隔离、哪些仍共享

| 面 | 拆库后 | 说明 / 对策 |
|---|---|---|
| **D1 执行队列** | ✅ 完全隔离 | 埋点洪水与分析慢查询不再影响业务读写。这是拆库的全部价值 |
| D1 额度与账单 | ❌ 仍共享 | 包含额度是**账户级**（5000 万行写/月、5 GB 存储），灌数据照样烧共享额度并转为计费 → **日配额熔断不可省** |
| Worker 请求与 CPU | ❌ 仍共享 | 若摄取端挂在现有 Worker 上，吃同一份 1000 万请求/月、3000 万 CPU 毫秒 |
| 部署节奏 | ❌ 仍共享（单 Worker 起步的已知代价） | 埋点改一次，业务 Worker 就重新部署一次。影响是几十毫秒的冷启动抖动，不是可用性——构建失败即不部署。评估与纪律见 4.4 |
| Workers Logs | ❌ 仍共享 | 2000 万条/月共享 → 摄取端只记失败、不记成功路径 |

### 4.3 连带代价：跨库 JOIN 消失（四个真实例子）

| 分析 | 同库时 | 拆库后 | 补法 |
|---|---|---|---|
| **付费漏斗** `paywall_view → plan_selected → checkout_opened` 到真实成单 | 一条 SQL JOIN `paddle_subscriptions` 出全程转化率 | 漏斗在 `checkout_opened` 断掉 | webhook 成单时**补发 `checkout_completed`（source=server）**。比 JOIN 更准：成单时刻精确到事件 |
| **Pro/赞助者行为复核**（`/sponsor-review`） | `pro_entitlements` JOIN 事件表 | 跨不过去 | 每日快照 `identity_id, plan, granted_at, expires_at` 进埋点库（现几十行）。**代价是精度**：当天升级的人会被算成免费用户 |
| **匿名配额拦新用户** | `usage_events`（带 `install_id`）× `chat_send`/`sign_in_*` | `usage_events` 是明细流水、量大，快照法不适用 | 拦截时**补发 `quota_blocked`**（带 `install_id` + `reason`） |
| **chat 埋点健康度对账**（`chat_send` 数 ≈ `chat_logs` 行数，残差即丢失率） | 一条 SQL | 两个数在两个库，只能各查一次再手工相减 | 每日把 `chat_logs` 计数写一行进埋点库的 `daily_rollup`（一天一行，且这张表本就在计划内） |

**三种补法，按优先级**：

| 优先级 | 手法 | 适用 | 代价 |
|---|---|---|---|
| 1 | **业务侧补发 server 事件** | 状态变更类（成单、拦截、退款、绑定） | 多几行写入；且它本身就是更好的设计——漏斗末端不该靠 JOIN 去推，这与决策 3「登录事件合表」同源 |
| 2 | 维表每日快照 | 小表慢变属性（identity → plan） | 当天内的状态变化丢失 |
| 3 | 每日聚合值写入 | 对账类（`chat_logs` 计数） | 只有天粒度 |

**一个先决条件**：事件的主键是 `install_id`（匿名），业务表是 `identity_id`。**这个映射必须住在埋点库里**（登录成功的事件带上 `user_id`），否则拆不拆库都对不齐。

**真正无解、只能手工查两次**：需要业务库明细、且事先无法预判要补什么事件的临时追问（如「这批人问了什么（`chat_logs` 全文）对应他们的点击路径」）。一年碰上几次，可接受。

**结论（已定）**：拆。前三种补法覆盖日常绝大部分分析，唯一真实损失是探索性明细追问，一年碰上几次、手工查两次可接受。

### 4.4 Worker 拓扑：单 Worker 起步（决策 6）

拆 D1 和拆 Worker 是两件事，**理由完全不同**：拆库是性能（单线程队列），拆 Worker 与性能无关（Workers 按请求自动横向扩，埋点洪水不会让业务请求变慢）。

**对现有业务接口的性能影响评估**：

| 耦合点 | 实际影响 | 判断 |
|---|---|---|
| Bundle 体积 | 埋点包（校验 + 参数化 SQL，无重依赖）约增几十 KB。付费档上限 gzip 后 10 MB，全局作用域须 1 秒内执行完 | 亚毫秒级，**唯一可测量但可忽略** |
| isolate 内 CPU 争用 | JS 单线程；埋点每请求约 1ms 级，当前量 **0.03 QPS** | 撞上概率极低；洪水时瓶颈是账单不是延迟 |
| `waitUntil` 写库 | 响应已返回，只延长计费生命周期 | 不阻塞业务响应 |
| 绑两个 D1 | 跨库写走各自队列 | 零影响（正是拆库要的） |
| **部署频次上升** | 埋点改动触发业务 Worker 重新部署 → 全球 isolate 重建，冷启动抖动、内存缓存清空 | **最真实的一条**，几十毫秒级瞬时 |
| 埋点代码有 bug | 构建失败即不部署 | 可用性风险 ≈ 0，发布节奏风险 > 0 |

**结论：性能影响实质为零**；真实代价是把发布节奏绑在一起。两条纪律压住它：**限流放在最前面**（拒绝路径不进任何解析）、**写库走 `waitUntil`**（响应先返回）。

**可验证**：`wrangler deploy` 输出会报 startup time，对比接入前后；双写并跑那 1~2 周在 observability 里看业务接口 p50/p99 是否变化。

**为什么不一开始就拆**：两 Worker 方案的代码成本很小（4 个文件的壳），成本大头是 Cloudflare 控制台里新建 Worker 项目、连 Git、设 root directory 与 watch paths——**不可版本化、写不进接入文档的一条命令**，每接一个 App 都要重做，会被 App 数量乘起来。而给已跑通的业务 Worker 补 watch paths，还要去动生产配置。

**安全那条理由被重新切分**：真正危险的不是摄取端（JSON 解析 + 参数化 INSERT，不读 secret），是**查询端点**；而它的风险已由决策 5 解决——查询端只绑埋点 D1，即使被绕过也读不到 `identities` / `paddle_subscriptions` / `gh_token_enc`。**拆库比拆 Worker 更能限制爆炸半径。**

### 4.5 将来拆 Worker 的成本与判据

拆分是**可逆且便宜**的，故推迟无风险：

| 步骤 | 耗时 |
|---|---|
| 建 `telemetry/` 目录，抽出挂载与配置 | 20 min |
| 独立 `package.json` + lockfile | 5 min |
| Cloudflare 新建 Worker 项目：连 Git、root directory、watch paths | 20 min |
| 给业务 Worker 补 watch paths（排除 `telemetry/`）——**唯一动生产配置的一步** | 5 min |
| 加 route `api.trendingai.cn/t/*` → 新 Worker（路由跑在 Custom Domain 之前） | 5 min |
| 新 Worker 重新 `secret put`（secrets 不跨 Worker） | 5 min |
| 观察通过后，删掉业务 Worker 里的旧挂载 | 5 min |

**合计 1~1.5 小时，且三个零**：零客户端改动（路径仍是 `/t/*`，App 不发版）、零数据迁移（同一个 D1）、零停机（route 边缘秒级生效，一个请求只会被一个 Worker 处理）。**顺序即回滚路径**：先建新 Worker + route、观察通过、最后才删旧挂载；出问题删 route 即回落。

唯一的长期新增负担是"两处 `package.json` 同时 bump"，早拆晚拆一样，不因推迟变贵。

**触发判据**（满足任一条即拆，不再讨论）：

1. observability 里业务接口 p99 出现可归因于埋点的抬升；
2. 埋点改动**卡过一次业务发布**（构建失败挡住紧急修复）；
3. 摄取端要开源、或交给别人维护；
4. 埋点 CPU 占账户额度比例超过 10%。

## 5. 接入形态与部署

### 5.0 命名：为什么是 `trending-events` 而不是 `trending-telemetry`

词汇一致性优先：库叫 `eventbase`、表叫 `events`，库名再引入第三个词会让人每次都要在脑子里做一次映射。

语义上 `telemetry` 也不是最准的那个词：OpenTelemetry 之后，telemetry 在行业里越来越指向 traces / metrics / logs
这一侧的**系统运行状态**，而本项目的核心 10 条指标全是留存、渗透率、漏斗这类**产品分析**（analytics）。
业界确实大量把客户端行为回传也叫 telemetry（VS Code、Firefox、.NET CLI），所以那样叫不算错，只是会带来
「里面应该有链路和指标」的错误预期。

### 5.1 拓扑（TrendingAI 为例）

```
客户端 App ──► api.trendingai.cn/t/*    ─┐
                                         ├─► [业务 Worker] ─binding─► D1: trending（业务）
业务请求  ──► api.trendingai.cn/api/*  ─┘         └────────binding─► D1: trending-events（埋点）
```

- 客户端不改 host、无新 DNS/证书，CN 链路与现状一致；
- **服务端事件不走 HTTP**：业务 Worker 直接用 binding 写埋点库（`checkout_completed`、`quota_blocked`、loginbase 的登录事件），省一次往返、也不受摄取限流影响。跨库写不会重新引入队列耦合——**隔离在库级，不在 Worker 级**。

### 5.2 包对外的两个入口

| 导出 | 谁用 | 作用 |
|---|---|---|
| `createIngest({ db, limiter, adminToken, … })` | 挂在 Worker 的 `/t/*` | 公开摄取 + 带 token 的取数 |
| `createTracker({ db })` | 业务代码、loginbase | 服务端 writer，直接写 D1 |
| `migrations/` | 消费方 | 表结构随包分发 |

### 5.3 接入清单（新 App，约 15 分钟）

```bash
npx wrangler d1 create <app>-telemetry                      # 1. 建库
# 2. wrangler.toml：加 d1 binding（migrations_dir 指向 node_modules）+ ratelimit binding
npx wrangler d1 migrations apply <app>-telemetry --remote   # 3. 迁移
npm i @whlong/eventbase                                     # 4. 装包，index.js 加 3 行挂载 /t
npx wrangler secret put EVENTBASE_ADMIN_TOKEN               # 5. 取数 token
```

```toml
[[d1_databases]]
binding = "EVENTS_DB"
database_name = "trending-events"
migrations_dir = "node_modules/@whlong/eventbase/migrations"   # 免复制迁移文件，升级包即带新迁移
```

**两处刻意降低接入门槛**（与 loginbase 的既有做法不同，理由是埋点库是全新独立库、迁移完全由包拥有）：

1. **迁移免复制**——loginbase 因与业务表共库、编号要排进同一序列，才让消费方复制文件（`041_auth_events.sql`）；埋点库直接把 `migrations_dir` 指向 `node_modules`，接入方永远不碰迁移文件；
2. **事件名白名单默认可选**——首次接入不必把约 60 个事件名抄进配置，默认只校验格式/长度/数量上限；白名单作为可选加固，等词汇稳定再开。

客户端侧：加一个 KMP 依赖 + 填 endpoint 与 appKey 两个值。**没有新的部署单元、没有控制台操作。**

### 5.4 部署顺序与故障面

顺序沿用既有铁律「**先迁移、后部署**」：建库 → apply migration → 部署 Worker。反过来会让新代码引用尚不存在的表，就是 039 那次 `/api/me` 全量 500 的形状。

故障面：摄取路由整体 try/catch，异常只影响 `/t/*`；服务端写事件一律 `waitUntil` + 吞异常（照抄 loginbase stats 第一原则：统计绝不能成为业务的故障源）。

## 6. 仓库与依赖关系

### 6.1 六个产物、三种角色

| 角色 | 仓库 | 产物 | 是否部署 |
|---|---|---|---|
| **库**（跑在消费方的 Worker 里） | `loginbase` | npm `loginbase` | ❌ |
| | `loginbase-kt` | Maven `wang.harlon:loginbase-kt` | ❌ |
| | 埋点服务端仓（新） | npm 包 + **协议文档唯一权威** | ❌ |
| | 埋点 KMP 仓（新） | Maven 客户端库 | ❌ |
| **部署方** | `github-ai-trending-api` | 业务 Worker（含 `/t/*` 摄取挂载）+ 两个 D1 | ✅ 唯一部署处 |
| **客户端** | `TrendingAI` | App | ✅ 发版 |

### 6.2 依赖方向

```
npm 侧
    埋点包(server) ◄──peerDependency── loginbase
         ▲                                ▲
         └────dependency──── github-ai-trending-api ──dependency──┘

Maven 侧
    埋点-kt ◄──?── loginbase-kt        ← 待议：登录相关的客户端事件由谁上报
       ▲              ▲
       └── TrendingAI ┘
```

**loginbase 依赖埋点包，反过来不成立**；埋点包不知道 loginbase 的存在。

### 6.3 数据归属：状态在业务库，事件在埋点库

| D1 库 | 表 | migration 由谁分发 | 谁写 |
|---|---|---|---|
| `trending`（业务） | `identities` / `sessions` / `paddle_subscriptions` / `pro_entitlements` / `chat_logs` / `usage_events` … | 业务仓自己（`sessions` 定义来自 loginbase） | 业务代码（含 loginbase 的会话读写） |
| `trending-events` | `events` / `daily_rollup` / 维表快照 | **埋点包** | 摄取端（客户端事件）+ 业务代码（server 事件，**含 loginbase 的登录事件**） |

loginbase 因此是"劈开"的：**会话状态留业务库，事件搬去埋点库**——这就是它要多接受一个 D1 binding、`auth_events` 退役的含义。

### 6.4 变更传导表

| 改了什么 | 要连带动谁 |
|---|---|
| 埋点**表结构** | 埋点包加 migration → 消费方 `migrations apply`（免复制）→ **先 apply 后部署** → 涉及上报格式还要改协议文档 + 在埋点 KMP 仓开跟进 issue |
| **新增一个事件名** | 只改客户端调用点（白名单未开时库与后端都不动、不发版） |
| 埋点包升级 | 业务仓 `package.json` 一处（单 Worker 起步的额外好处：**不存在两处 bump 的漂移风险**，拆 Worker 后才会有） |
| loginbase 升级 | 业务仓 `package.json`；它若带 migration 则复制进业务仓 `migrations/` |
| 客户端 SDK 升级 | `TrendingAI` 的 gradle，不影响后端 |
