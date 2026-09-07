# eventbase 指标与数据模型设计

分层讨论记录：L1 目的与边界 → L2 指标清单 → L3 数据模型（含事件词汇）→ L4 非功能。**上层不定稿不进下层**，连带问题记进文末待议清单并标层级。

本文只定**通用层**：口径约定、数据模型、命名规范、非功能约束。各 App 自己的核心指标清单与事件词汇表归其私有文档持有——本库不认识任何具体事件名（见 `design.md` 6.4 变更传导表），接入时按同一套分层各自定稿。

> **编号说明**：本文的章节编号沿用调研原稿（2026-08-18 拆分入库），跨文件引用共用同一套编号：
>
> | 章节 | 所在文件 |
> |---|---|
> | §1 动机、§3 容量测算、§8 迁移面、§9 阶段与成本 | `docs/migration-from-aptabase.md`（具体读数记在私有仓） |
> | §2 决策、§4 存储与部署拓扑、§5 接入形态、§6 仓库关系 | `docs/design.md` |
> | §7 摄取端滥用面、§10~§14（L1~L4 与待议） | `docs/telemetry-design.md` |
> | 两端契约 | `docs/protocol.md` |

---

## 10. L1 目的与边界（定稿 2026-08-18）

**受众**：我自己（产品 + 运维）；以及**能直接取数的 Claude**——后者是本项目区别于 Aptabase 的核心，接口形态要照「非人类消费者」设计。

**要回答的问题**：

1. **规模与留存**——多少人在用、新老构成、次日/7 日回访（口径一律 `install_id`，不用会轮换的 user_id）；
2. **功能使用与漏斗**——哪些功能被用、哪一步在掉人（登录、付费、核心功能）；
3. **版本与渠道切片**——每个指标都可按 app 版本 / 渠道 / 平台 / 语言 / 国家拆。

**载体**：各 App 自己的 Cloudflare D1；取数走带 token 的 HTTP 接口。**v1 不做看板 UI**。

**明确不在范围**：

| 不做 | 理由 |
|---|---|
| 看板 / 图表 UI | v1 的消费者是 SQL 与 Claude，不是眼睛 |
| 会话录制、热图、精确到用户的行为回放 | 隐私成本与实现成本都不匹配收益 |
| 实时告警 | L5 之后 |
| 服务端业务账本（计费流水、AI 请求日志） | 已有且口径不同，不并入 |
| 跨 App 统一视图 | 决策 2 已定：各落各的 D1 |

## 11. L2 指标清单（定稿 2026-08-18）

> 本层只回答「要哪些数、每个数的口径」。表字段、端点形态属 L3，不在此展开。

### 11.1 公共口径约定

| 约定 | 内容 |
|---|---|
| 去重单位 | **一律 `install_id`**。Aptabase 的 `user_id` 每日轮换哈希、跨天失效，这是自建的直接动因之一。`device_id`（若消费方注入）**不作去重单位**，只用来算「设备数 ÷ 安装数」得重装率，反过来校准新增与留存——它在 Android 上按「签名密钥 × 用户 × 设备」隔离，同机多 profile 会算成两台，当主口径并不更准 |
| 日界 | **UTC+8**（定）。存储一律 UTC 毫秒，`day` 列由服务端按 UTC+8 算好落库。理由：这些指标的消费者是产品判断，不是与 cron 对账 |
| 剔除项 | debug 构建、诊断流量、入口标记为污染的流量（后台唤醒空 session、爬虫批次） |
| 新老划分 | install 首次出现 < 24h 记为新增；安装日 = 该 `install_id` 首次出现的日期 |
| 默认分母 | 「当日活跃 install」= 当日有任意非污染事件的去重 `install_id` |
| 事件来源标记 | `[客]` 客户端上报 / `[服]` loginbase 等服务端 / `[业]` 业务侧补发（见 4.3 补法 1） |

### 11.2 核心指标

库内置五个固定指标（`active` / `new_installs` / `retention` / `events` / `drops`，见 `protocol.md`），覆盖 L1 第 1 类「规模与留存」；第 2 类「功能使用与漏斗」由各 App 按自己的事件词汇定义，用 `POST /sql` 取数。**App 的核心指标清单与其事件词汇同住一份私有文档**，不放本仓。

两条通用约束：

- 漏斗末端若落在业务库，一律补发 server 事件，不靠跨库 JOIN（见 12.6）；
- 埋点健康度（丢失率）是**元指标**：客户端事件数 vs 业务侧同一动作的日志行数之差，其余指标可不可信全看它。

### 11.3 切片维度（每条核心指标都可按此拆）

`app_version` / `channel`（值域由消费方按自己的分发渠道定义，如 play / fdroid / 直装包）/ `platform`（android / ios）/ `sys_locale` / `country`（边缘 `request.cf`）/ 登录态（匿名 / 已登录 / 付费）

L1 第 3 类问题（版本与渠道）由此满足——它是**切片轴**，不是独立指标。

### 11.4 备选指标

不进核心、按需再取的指标同样归 App 私有文档。通用的两条：版本升级速度（新版本发布后 7 天覆盖率，强更决策要用）、污染流量占比（爬虫批次、后台唤醒）。

### 11.5 本层已定与遗留

**已定（2026-08-18）**：

1. **日界 = UTC+8**，存 UTC 毫秒、服务端算 `day` 列；
2. **登录漏斗口径归属**：服务端段以 loginbase `docs/stats-design.md` 为准，本文只定客户端段，两处不各自定义。

**遗留（不阻塞 L3）**：

3. 迁移期断点：双写并跑期两侧要对账，切换点前后不可直接连成一条曲线（见 `migration-from-aptabase.md` §8）。

## 12. L3 数据模型（定稿 2026-08-18）

### 12.1 事件表 `events`

server 与 client 事件**同表**，靠 `source` 区分，字段取并集、多数可空（形态沿用 loginbase `auth_events` 的既有结论）。

```sql
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  INTEGER NOT NULL,          -- 服务端权威时间（UTC ms），分析默认用它
  event_at     INTEGER,                   -- 客户端声明时间，仅用于排序与时钟纠偏
  day          TEXT    NOT NULL,          -- 'YYYY-MM-DD'，UTC+8 日界，服务端算，索引主力
  name         TEXT    NOT NULL,
  source       TEXT    NOT NULL,          -- client | server
  install_id   TEXT,                      -- 客户端事件必有
  device_id    TEXT,                      -- 可选，仅落客户端显式带上的值；服务端不采集也不推导
  user_id      TEXT,                      -- 登录后有；server 事件多数有
  session_id   TEXT,
  flow_id      TEXT,                      -- 跨端漏斗串联，语义复用 loginbase
  app_version  TEXT,
  platform     TEXT,                      -- android | ios | server
  channel      TEXT,                      -- github | play | fdroid | r2 | ...（值域由消费方定）
  sys_locale   TEXT,
  country      TEXT, asn INTEGER, colo TEXT, timezone TEXT,   -- 全部取自 request.cf
  is_debug     INTEGER NOT NULL DEFAULT 0,
  ingest_flags TEXT,                      -- 入口打标：bot / bg_wake / diag / …
  props        TEXT                       -- JSON 单列（定），低频字段
);
```

**不建 `app_id` 列**：各 App 独立库（决策 2），冗余；将来真要做跨 App 视图再加。

**索引与写入成本**（D1 的 `rows written` **包含索引行**：一次 INSERT 写表 1 行 + 每个命中索引各 1 行）：

| 索引 | 服务的查询 |
|---|---|
| `(day)` | 时间范围扫描（几乎所有指标） |
| `(name, day)` | 单事件按天聚合 |
| `(install_id, day)` | 留存 / 去重活跃 |
| `(flow_id)` | 漏斗串联 |

**`props` 用单列 JSON（定）**，不学 Aptabase 拆 string/number 两个 map——那是 ClickHouse 有类型化 Map 列才有的收益；在 SQLite 上两者都只能存 TEXT，`json_extract` 取出的数字本来就能直接聚合，拆列只多一层协议复杂度。需要加速时对具体路径建**表达式索引**（如某事件的 `source`），不把属性提成真实列——提列会让 schema 随各 App 的事件词汇漂移，违反「库要通用」。⚠️ 表达式索引在 D1 上未实测，实现时验。

4 个索引 = **每事件 5 行写入**；对着 D1 的 5000 万行/月写入额度算，个位数千事件/天的量级仍是零头。但**索引不可滥建**，新增前先确认有核心指标要它。

### 12.2 辅助表（三张小表）

```sql
-- install ↔ 账号映射：多对多天然支持（一机多账号 / 一号多机）
CREATE TABLE install_identity (
  install_id TEXT NOT NULL, user_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  PRIMARY KEY (install_id, user_id)
);

-- 对账值与将来的预聚合：一天几行
CREATE TABLE daily_rollup (
  day TEXT NOT NULL, metric TEXT NOT NULL, dim TEXT, value REAL,
  PRIMARY KEY (day, metric, dim)
);

-- install 首次出现的物化表：**与保留期无关也必须建**。
-- 「新增 install」若靠扫全历史求 min(day)，既昂贵又会在明细被裁剪时失真——
-- 首次出现时的归因维度在此冻结，用户之后换版本/渠道不影响归因。
CREATE TABLE install_first_seen (
  install_id  TEXT PRIMARY KEY,
  first_day   TEXT NOT NULL,   -- 该 install 已接受事件里最小的 day，晚到的更早事件会改小它
  channel TEXT, app_version TEXT, platform TEXT, country TEXT, sys_locale TEXT
);
-- debug 批不写此表：一台机器可能既跑 debug 又跑正式包，写了就永久钉死；
-- 不写则留存的分母天然干净，比加 is_debug 列少一次迁移。

-- 摄取端丢弃计数（实现时补，2026-08-19）。恒 204 让丢弃对客户端不可见，
-- 服务端自己得留一笔，否则「丢了多少」我们也答不上来。按天按原因聚合，不带 install 维度。
-- 限流丢弃刻意不记：那条路径必须保持零 D1，洪水时每请求写一行等于抵消限流。
CREATE TABLE ingest_drops (
  day TEXT NOT NULL, reason TEXT NOT NULL,  -- invalid | expired | future | unknown_event | quota
  n INTEGER NOT NULL,
  PRIMARY KEY (day, reason)
);

-- 日配额计数（实现时补，2026-08-19）。限流绑定按 colo 局部计数，跨 colo 的日配额只能落库。
CREATE TABLE ingest_quota (
  day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (day, key)
);

-- 业务维表每日快照（补法 2）：现在几十行
CREATE TABLE dim_identity_daily (
  day TEXT NOT NULL, user_id TEXT NOT NULL,
  plan TEXT, plan_since INTEGER, first_seen INTEGER,
  PRIMARY KEY (day, user_id)
);
```

`install_identity` 的写入时机：登录成功事件带 `user_id` 时 upsert。**补登问题**（老用户升级到新版前的历史 install 无映射）不回填，接受首版只覆盖新世代。

### 12.3 摄取端点

`POST /t/e`，body 形如 `{ key, install, session, sys{version,platform,channel,locale,debug}, events:[{name, at, props}] }`。

| 约束 | 值 | 依据 |
|---|---|---|
| 单批事件数 | ≤ 25 | 照 Aptabase |
| body 体积 | ≤ 64 KB | |
| 事件名 | ≤ 60 字符 | 照 Aptabase |
| props 键数 / 键长 / 串值 | ≤ 20 / ≤ 40 字符 / 截断 180 | 治基数爆炸 |
| 时间戳 | 未来 > 10 分钟拒；早于 7 天拒 | 防灌历史数据；窗口刻意比 Aptabase 的 24 小时宽，理由见本文「过期窗口」 |
| 限流 | `limiter.limit({key: install_id})` 60s 窗口，兜底再按 IP 限一层 | Workers 原生绑定，按 colo 局部 |
| 日配额 | per install + 全局，D1 计数，超了直接丢 | 跨 colo 需汇总，限流绑定做不到 |
| 返回 | 恒 204，不回传错误细节 | 单条无效只丢那条，其余照收 |

### 12.4 取数端点

`GET /t/q`，`Authorization: Bearer <EVENTBASE_ADMIN_TOKEN>`。两种形态并存：

1. **固定指标**（带日期范围与切片参数）——稳定、可缓存、给定期复核用；
2. **受限 SQL**（只允许 `SELECT`、只连埋点库、结果行数封顶）——给临时追问与 Claude 用。

风险已由拆库兜住：这个端点即使被绕过也读不到业务库（见 7.2）。

### 12.5 session 由客户端定义

客户端算 duration（只有它知道前后台切换），服务端只做合法性校验（sessionId ≤ 36 字符、时间窗合理）。**必须带上「是否后台唤醒产生」的标记**，直接落 `ingest_flags`——Aptabase 时代曾有一次后台唤醒污染，正是因为这个区分只能事后猜。

#### 三个口径不是一回事（2026-08-22 补，读数前必须分清）

`eventbase-kt` 的 `LifecycleTracker` 里 `opened` 标记**进程内一次性、永不复位**，于是：

| 数什么 | 用什么 | 语义 |
|---|---|---|
| 进程启动次数 | `app_opened` 计数 | ≈ 冷启动。每个进程生命周期**只报一次** |
| 前台停留区间数 | `app_backgrounded` 计数 | 每次进后台报一次，一个进程内可以有很多次 |
| 会话数 | `session_id` 去重 | 与进程一一对应 |

实测三者可相差数倍。「人均日会话数 / 会话时长中位数」用的是 `app_backgrounded.duration_s`，即**前台停留区间**口径——从后台回到前台不会产生新的 `app_opened`，别拿它当"打开次数"。

**`app_opened` 没有 `is_cold` 属性**（早期草案里写过，从未实现：库里 `AppOpened` 是个空 props 的 object）。**决定不补**：`is_cold=false` 的热启动等价于"又一次前台区间"，那正是 `app_backgrounded` 已经在数的东西，加它只是把同一个信息记两遍。删属性、把上面三行口径写清楚，比让库多认一个状态更划算。

### 12.6 起步要补发的 server 事件（补法 1）

判据：**漏斗末端落在业务库的，一律补发事件，不靠 JOIN**。典型四类：支付 webhook 的成单与退款、配额闸拦截、以及 loginbase 的全部登录事件（loginbase 内部产生）。具体事件名归 App 词汇表。

补发事件**必须带 install_id**：漏斗前段是客户端事件、按 install 去重，末端缺 install_id 时 `COUNT(DISTINCT install_id)` 忽略 NULL，成单恒为 0——与「没人付款」表现完全一致，无任何迹象指向口径。成单场景下 install_id 要在下单时经支付商的自定义字段带出、webhook 原样带回，服务端没有第二个来源。

### 12.7 loginbase 侧改动

1. 新增可选的第二个 D1 binding（`statsDb`），事件写埋点库而非业务库；
2. `stats.enabled` 默认关，`auth_events` 退役（存量自 2026-08-17，量极小，直接弃用）；
3. writer 签名要能传请求上下文（地理六项取自 `request.cf`）；
4. 以上属其配置接口变更，须与决策 4 一并落到 loginbase 的 `protocol.md` / README。

### 12.8 客户端上报与离线队列（定）

| 参数 | 值 |
|---|---|
| 队列上限 | **500 条**（约 100 KB）。每设备每天约 10~20 事件，够扛一个月不联网 |
| 溢出策略 | **丢最老** |
| 客户端自清 | 出队前丢弃 `event_at` 超过 **7 天**的事件 |
| 服务端过期窗口 | **7 天**（Aptabase 是 24 小时，此处刻意放宽） |

丢最老的决定性理由不是「新数据更值钱」，而是**两端口径必须一致**：服务端会拒收过期事件，客户端死攥老事件攒到最后也是被拒——白占队列、白耗电。所以自清窗口与拒收窗口必须同一个数。

放宽到 7 天的理由：24 小时对「装了但几天才打开一次」的用户太狠，而那批人正是留存分析里最关键的一群。代价（灌历史数据的窗口变大）已由限流与日配额挡住。

**连带口径（必须一起接受）**：`day` 列按 **`event_at`** 算而非 `received_at`，否则离线补报会被记到上报当天、活跃日与留存队列全错。由此历史日期的数字**会被晚到事件追加修改**，故约定：**读数以 T+2 为准**，`daily_rollup` 也在 T+2 定稿。今天看昨天的数会偏低一点，这是正确性的代价。

### 12.9 事件词汇：命名规范

**词汇表由 App 持有**。本库与客户端库都不认识具体事件名：服务端只校验格式、长度与数量上限（白名单可选，见 `design.md` 5.3），客户端库的 `Event` 只是 name + props 的接口。库自身只产生两个事件：`app_opened`（进程内一次）与 `app_backgrounded`（带 `duration_s`、`is_wake`），口径见 12.5。

#### 设计原则

| 原则 | 做法 |
|---|---|
| 少事件、富属性 | 维度进 props，不进事件名。反例是每个设置项、每个页面各起一个事件名：曲线一多就无法归因，触发位置一搬语义就静默变了 |
| 统一命名 | `object_action`，动词一律**过去式**；props 一律 snake_case，布尔用 `is_`/`has_` 前缀，时长用 `_ms`/`_s` 后缀 |
| 页面浏览统一 | 一个 `screen_viewed` + `screen` 属性；**由导航层自动产生**（路由声明带 `screen`，漏填即编译失败），新增页面零埋点改动；返回（pop）算一次浏览，与 GA / Firebase 一致 |
| 漏斗成对 | 关键流程一律 `*_started` / `*_finished`（后者带 `outcome`），不为每种结局单开事件 |
| **强类型调用面** | 客户端用 sealed class 定义事件与属性，取代裸字符串；编译期防拼写与漏属性，改名即全局重构 |
| 单一 taxonomy 来源 | 同一份定义供客户端与服务端白名单，两侧不漂移 |
| 变更纪律 | **语义变了就用新事件名，绝不复用旧名**——根治「同名不同义」。退役的值在词汇表里划掉并标日期，不删行 |
| 低基数 `reason` | 错误原因取协议层的机器错误串（如 loginbase 的 wire error），**不要把面向用户的本地化文案写进维度**——多语言高基数脏值一进库这个维度就废了 |

#### 词汇表的形态

每行一个事件：事件名、关键 props 及其取值、来源（客户端 / server / 库自产）。属性值域写全，含义特殊的值单独注明——例如「打开登录面板」与「选定某种登录方式」若共用 `method` 字段，读数的人必然把前者当成第三种登录方式。

#### 内容标识属性

拆库后埋点库 JOIN 不到业务库的内容表，只带 `content_id` 的读数只剩一串 id。允许带一个截断的公开标题（≤ 60 字符）作为可读性代价，但**禁止任何用户生成内容**（见 13.1）。

### 12.10 本层待定

1. 事件名白名单开启的时机与维护位置（默认可选，见 5.3）；
2. `loginbase-kt` 是否依赖埋点 KMP 库——登录漏斗的客户端段由 App 自己上报即可，**倾向不连这条线**；
3. 保留期与 purge 属 L4（见 13.2），`day` 列与 `daily_rollup` 已为它留好位置。

## 7. 摄取端滥用面（L4 草案）

摄取端是**公开写入口**，客户端凭据必然可反编译（Segment write key、Amplitude API key、GA measurement ID、Aptabase `App-Key` 全是公开的）。业界共识是**不试图鉴权，只限制损害**：入口校验 → 限流配额 → 服务端时间权威 → 事后可清洗。

### 7.1 Aptabase 自己的做法（读其源码所得，AGPL-3.0，只照做法不抄代码）

| 层 | 做法 |
|---|---|
| 身份 | `App-Key` 头只用于路由到哪个 App + 查账号是否被锁，不做鉴权 |
| 限流 | 固定窗口 **每 IP 20 请求/秒** |
| 批量上限 | 单请求最多 **25 条**，超了整个 400 |
| 字段上限 | 事件名 ≤ 60 字符、property key ≤ 40、字符串值截断 180、locale ≤ 10、DeviceModel ≤ 100 |
| **时间戳** | 客户端时间未来 > 10 分钟拒、早于 7 天拒；setter 里把未来时间钳回 now |
| session | sessionId ≤ 36 字符；数字型（内嵌 epoch）未来 > 10 分钟或早于 7 天拒 |
| 脏数据 | 批量里单条无效只丢那条，其余照收 |
| 写入 | 事件先进内存 buffer，后台 writer **每 10 秒批量 flush**；flush 失败整批丢弃只记 error |

它**没做**的同样有信息量：无签名、无 Play Integrity / App Attest、无 bot UA 拦截、无 per-app 事件配额。一家商业埋点服务只做到这里，说明性价比拐点就在这条线上。

### 7.2 我们的取舍

- **风险的正确切分**：危险的不是摄取端（JSON 解析 + 参数化 INSERT，不读任何 secret），是**查询端点**；而它已由决策 5 兜住——查询端只绑埋点 D1，即使 token 泄露也读不到 `users` / `subscriptions` / `oauth_tokens`。**拆库比拆 Worker 更能限制爆炸半径**（这也是决策 6 敢单 Worker 起步的前提）。
- **必做**：属性数量与长度上限、批量条数与 body 体积上限（治的其实是**基数爆炸**，业界怕脏基数甚于怕假数据）；双时间戳（`received_at` 服务端权威 + `event_time` 客户端仅供排序与时钟纠偏）；事件名白名单（**默认可选**，见 5.3）；**入口即打标**的 `ingest_flags`，分析层按标记过滤而非入口硬删——反例是诊断流量混进业务流水表，之后每次查询都得记着排除某个前缀。
- **限流用 Workers 原生限流绑定**（免费、与 zone 计划无关）：`env.LIMITER.limit({ key })`，period **只能 10 或 60 秒**，**按 colo 局部计数、最终一致**。挡洪水够用，**但不能当日配额**（跨 colo 不汇总）——日配额要自己用 D1/KV 计。
  - 注：$5 是 **Workers Paid**，不是 zone 的 Pro（$25）。WAF 限流规则数仍是 Free zone 的 1 条，但有了 Workers 绑定就不依赖它。
- **明确不做 Play Integrity / App Attest**：消费方若在 **F-Droid 分发**（自行构建、签名不同），Play Integrity 会把这批真实用户判为不可信；App Attest 同理只覆盖 App Store。为防脏数据而丢真用户，不划算。
- **写入必须批量**：D1 单线程下查询**次数**比数据量更致命，客户端攒批 + 服务端一次 batch insert。
- **兜底**：开 Cloudflare Budget alert（零成本），加自己的日配额熔断——超了直接丢事件，宁可丢埋点。

## 13. L4 非功能（定稿 2026-08-18）

### 13.1 隐私与合规

| 项 | 结论 |
|---|---|
| 原始 IP | **不存**。只留 `country` / `asn` / `colo` / `timezone`（全取自 `request.cf`）——与 loginbase v1 同一结论 |
| User-Agent | **不存**。客户端已显式上报 platform / app_version / locale，UA 无增量信息 |
| `install_id` | 随机 UUID，卸载重装即变；**不使用任何设备标识符**（不取 ANDROID_ID / IDFV） |
| `device_id` | 可选字段，**本服务与客户端库都不采集、不推导**，只透传消费方显式传入的值。设备标识符会牵出 Play 数据安全 / App Store 隐私标签 / GDPR 的单独申报，默认不带就不该让所有接入方承担这份义务；需要设备维度的 App 自己有权威源（如崩溃上报 SDK 的设备 id），由它注入并自行申报 |
| 与身份的关联 | 登录后经 `install_identity` 与账号关联 → Play 数据安全表单必须如实声明「与身份关联」，不能按纯匿名申报 |
| props 内容 | **禁止出现用户生成内容**（chat 正文、搜索词、邮箱）。公开条目标题截断 **60** 字符后可留（见 12.9） |
| 对外文档 | 隐私政策与 Play 数据安全表单要同步改采集方（第三方 Aptabase → 自有服务） |

### 13.2 保留期：明细永久保留（定 2026-08-18）

**决策：不设保留期，明细 `events` 永久保留**（在 A=180 天 / B=365 天 / C=永久 三种姿态中选 C）。

理由是成本算完之后这不再是成本题：按当前量级永久保留数年也只占单库 10 GB 上限的零头（测算记在私有仓）。换来的是**分析自由度最大**——不会出现「当初没预先聚合过的口径，事后永久失效」。

**代价（要诚实记着）**：

1. 与「数据最小化」的姿态相悖，隐私政策措辞要如实写明匿名事件长期保留；F-Droid 那类用户群对此敏感 → **强化了 13.1「给用户开关」的必要性**；
2. 查询成本随时间线性上升。所以 `day` 索引与 `daily_rollup` 仍要做——**不是为 purge 做的，是为查询性能做的**；
3. 10 GB 单库上限成为长期终点。**监控项**：库体积超过 5 GB 时重新评估（按年分表、或把冷数据搬去 R2/Analytics Engine）。

**purge 不做**，但两件事仍按原计划先落地，因为它们与保留期无关：`install_first_seen` 物化表（12.2）与 `daily_rollup`。

### 13.3 开关与降级（kill switch）

三层，从外到内：

1. **客户端开关**（用户自己关，见 13.1）；
2. **服务端全局开关**——放 KV，改完即时生效、无需部署（照消费方现有 KV 配置的做法）；
3. **日配额熔断**——超了直接丢。

摄取端**恒返回 204**：服务端关闭或丢弃时也不回错误，避免客户端把它当失败去重试，造成风暴。

### 13.4 版本线与分发（照 loginbase）

- 服务端 npm 包：tag 触发 CI + trusted publishing（带 provenance）；
- KMP 客户端：Maven Central，**姊妹仓自有 tag** 触发，`wang.harlon:<name>-kt`；
- 协议文档住服务端仓、是唯一权威；两仓独立版本线，tag 为裸版本号；
- migration 随包分发，消费方 `migrations_dir` 指向 `node_modules`（见 5.3）。

### 13.5 命名：eventbase（定 2026-08-18）

项目名 **eventbase**，与 loginbase 同族。坐标：

| 坐标 | 值 | 状态 |
|---|---|---|
| GitHub 服务端仓 | `HarlonWang/eventbase` | ✅ 可用 |
| GitHub 客户端仓 | `HarlonWang/eventbase-kt` | ✅ 可用 |
| Maven | `wang.harlon:eventbase-kt` | ✅ 自有 namespace |
| Kotlin 包 | `wang.harlon.eventbase` | ✅ |
| **npm** | **`@whlong/eventbase`**（scoped） | 裸名 `eventbase` 被占 |

**只有 npm 裸名有冲突**：`eventbase` 是 2014 年的老包，实质废弃但 npm 不会自动回收。选 scoped 而非 `eventbase-cf` 这类后缀，因为 scope 是自有命名空间、永远不会再被抢，且名字本身保持干净。裸名不再争取。

### 13.6 安全与运维

- 取数 token **单独一把**，与业务的 `ADMIN_TOKEN` 分开，可独立轮换；
- 开 Cloudflare **Budget alert**（零成本兜底，只通知不暂停）；
- 限流阈值初值（待实测调整）：每 install 60 秒 60 条、每 IP 60 秒 600 条；日配额 per install 2000、全局 50 万。

### 13.7 本层已全部定稿（2026-08-18）

1. 保留期 → 13.2：**永久保留，不做 purge**；
2. 用户开关 → 13.1：**先不给**，敞口已记录，随时可加；
3. 命名 → 13.5：**eventbase**，npm 走 `@whlong/eventbase`。

## 14. 待议清单

**L2 指标**
- ~~核心指标清单尚未选~~ → 草案已落第 11 节，待定稿；未决项见 11.5（日界口径、与 loginbase 登录漏斗的口径归属）

**L3 数据模型** → 草案已落第 12 节，未决项见 12.8

- ~~表结构：server / client 事件同表靠 `source` 区分~~ → 12.1
- ~~摄取端点形态：批量 body、限流维度、单批上限~~ → 12.3
- ~~loginbase 调本库 writer 的接口形态（决策 4）~~ → 12.7；仍未定的是签名细节：writer 必须拿到请求上下文（地理六项取自 `request.cf`），签名要能传；以及 loginbase 侧 `stats.enabled` 与 `auth_events` 的退役步骤
- 客户端侧的同构问题：`loginbase-kt` 是否依赖埋点 KMP 库 → 12.8 第 4 条，**倾向不连**
- ~~session 的定义由谁给~~ → 12.5：客户端算，且必须带后台唤醒标记
- ~~**`install_id` ↔ `identity_id` 映射**~~ → 12.2 `install_identity` 表；补登不回填。原文：（拆库的先决条件，见 4.3）：靠登录成功事件带 `user_id` 写进埋点库；补登（老用户升级后首次登录前）怎么处理、一机多账号与一账号多机怎么表达
- ~~**要补发哪些 server 事件**~~ → 12.6 起步四类。原文：（拆库后漏斗闭合的主力，见 4.3 补法 1）：起步清单 `checkout_completed` / `quota_blocked` / 退款 / 绑定；判据是「漏斗末端落在业务库」的都要补
- ~~**维表快照与 daily_rollup 的形态**~~ → 12.2 两张表已定；仍未定跑批时机。原文：快照哪些列、几点跑、用 cron 还是随业务批处理；rollup 先收哪几个对账口径（AI 请求日志计数是第一个）
- loginbase 需要接受**第二个 D1 binding**（如 `statsDb`）才能把登录事件写进埋点库（决策 5 拆库的必然结果）——属其配置接口变更，须与决策 4 一并落到 protocol/README

**L4 非功能** → 草案已落第 13 节，未决项见 13.7

- ~~保留期与 purge~~ → 13.2 已定：**明细永久保留、不做 purge**；遗留监控项：库体积超 5 GB 时重新评估
- ~~摄取端是公开写入口，滥用面防护是硬要求~~ → 草案已落第 7 节；仍未定的是具体阈值（每 IP / 每 install 的 limit、日配额数值）与白名单开启时机
- ~~隐私：IP 存不存、Play 数据安全表单更新~~ → 13.1：IP/UA 都不存；表单要按「与身份关联」申报；用户开关待拍
- ~~命名~~ → 13.5 已定：**eventbase**（npm 用 scoped `@whlong/eventbase`，裸名被 2014 年废弃包占用）

**L5 之后**
- 摄取端拆独立 Worker（可逆、1~1.5 小时，触发判据见 4.5）
- 看板 UI
- 告警
- 其他 App 接入
