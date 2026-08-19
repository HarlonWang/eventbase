# 代码审查发现清单（2026-08-19）

首版实现（服务端摄取/取数 + KMP 客户端）的三方审查结果与处理状态。**修完一条就在此更新状态**，不要另起清单。

- 审查载体：两个仓各一个「回顾式 PR #1」——base 指向建仓 commit，diff 即骨架之后的全部实现，审完关闭不合并
- 三方：CodeRabbit（GitHub App）、ultra（`/code-review ultra`，云端多智能体）、自审

## 方法学结论（值得留存的部分）

| 手段 | 产出 | 误报 | 擅长 |
|---|---|---|---|
| CodeRabbit | 服务端 11 + 客户端 16 | 1/27 | **接口契约与边界细节**：`expectSuccess` 让 4xx 被判重试、early-return 顺手跳过 flush、`purgeExpired` 只从队头停 |
| ultra | 服务端 4（8 候选自否 4）+ 客户端 12（20 候选自否 8） | 0/16 | **跨状态、跨时间推理**：flush 时刻 vs track 时刻、进程重启、配置变更、构造式输入（`events:[null]`） |
| 自审 | 客户端 7（**0 条独有**）+ 服务端 6（**全部独有**） | — | 读代码零价值，**设计对抗实验全是独有发现**（离线拿 `/sql` 黑名单跑对抗用例） |

三条硬结论：

1. **服务端两方零重叠**（CodeRabbit 10 有效 vs ultra 4），客户端也只有 3 条三方共见——**两者不可互相替代**；
2. ultra 零误报不是运气，它有独立 verify 阶段，自己砍掉 28 个候选里的 12 个；
3. **对刚写完的代码，作者重读几乎没有独立价值**；自审要改成设计实验。

流程决定：常规 PR 靠 CodeRabbit 自动审（base 是默认分支才会自动触发，否则要 `@coderabbitai full review`）；涉及并发/状态机/协议/公开入口的实现另跑 ultra；提交前的自审做对抗实验而非重读。

## 服务端 eventbase（20 条）

| # | 问题 | 来源 | 状态 |
|---|---|---|---|
| S1 | `metric in METRICS` 走原型链，`/m/constructor` → 500 | CR | ✅ 已修 |
| S2 | `from`/`to` 未校验，`?to=garbage` → 500 | CR | ✅ 已修 |
| S3 | 两处 D1 执行未包 try → 500 且回原始错误 | CR | ✅ 已修 |
| S4 | `events` 指标忽略 `by` 却回显 | CR | ✅ 已修（`METRIC_SLICES`） |
| S5 | `new_installs?by=sys_locale` → 500（列不存在） | ultra | ✅ 已修（0002 迁移加列，切片真正可用） |
| S6 | `retention` 忽略 `by` | ultra | ✅ 已修 |
| S7 | `retention` 不过滤 `is_debug`，与 `active` 口径不一致 | ultra | ✅ 已修（分子加 JOIN 过滤；分母改为 debug 批不写 `install_first_seen`） |
| S8 | `events:[null]` 崩溃，破坏恒 204 契约 | ultra | ✅ 已修 |
| S9 | 文档写 24 小时、代码是 7 天 | CR | ✅ 已修（改文档） |
| S10 | 两处测试未用 try/finally 恢复现场 | CR | ✅ 已修 |
| S11 | 配额先扣后写，写失败不补偿 → 重试再扣 → 触顶后 204 **永久丢批** | CR | ✅ 已修（改只读判断 + 记账并入同一 `db.batch`） |
| S12 | `first_day` 用 `receivedAt` 而事件用 `event_at` → 离线补报跨日时 cohort 与事件错位，retention 失真 | CR | ✅ 已修（取批内最小事件日 + `ON CONFLICT` 取更小值） |
| S13 | `n` 参数无边界，`1e12`/`-1`/`1.5` 直接进 SQL | CR | ✅ 已修（限 `0..90` 整数，超范围 400） |
| S14 | `/sql` 漏网：递归 CTE 炸弹（CPU） | 自审 | ✅ 已修（按结构认自引用，见下） |
| S15 | `/sql` 漏网：可读 `sqlite_master` | 自审 | ✅ 已修（表名白名单） |
| S16 | `/sql` 漏网：`randomblob` 撑内存 | 自审 | ✅ 已修（函数黑名单） |
| S17 | `/sql` 漏网：`load_extension` 未拦 | 自审 | ✅ 已修（函数黑名单） |
| S18 | `/sql` 误杀：字符串/注释中含 `update`/`insert` 的正当查询被拒 | 自审 | ✅ 已修（先剥骨架再检查） |
| S19 | `tracker` 写入完全静默，「表没建」这类问题不可见 | CR | ✅ 已修（可选 `onError`，整进程只回调一次） |
| S20 | 「恒 204」措辞被误读成「所有拒绝都 204」 | CR（误报） | ✅ 已修（改 protocol.md 措辞，代码未动） |

S1~S10 由另一个会话自主修复（2026-08-19，43 测试通过）。S5/S7 的补完与 S11/S12 在同一批落地（47 测试通过）。

三条实现决定（与最初提案不同，记在这里免得下次重推）：

- **S5 加列、S7 不加列**。`sys_locale` 首见冻结正是安装归因该有的语义，值得一次迁移；`is_debug` 不加——一台机器可能既跑 debug 又跑正式包，首见冻结会把它永久钉死，改成 debug 批根本不写 `install_first_seen`，分母天然干净且省一次迁移。
- **S11 不做补偿回滚**：补偿本身也会失败，等于回到同一个问题。改成「只读判断 + 记账并入事件的 `db.batch`」——D1 batch 是单事务，配额与事件同生共死，没有新的失败路径。代价只是触顶那一批放行一次，而配额是熔断不是精确计费。
- **S12 顺手把跨批也修了**：`ON CONFLICT DO UPDATE SET first_day = MIN(...)`，否则更早的事件晚到时仍然改不动已冻结的安装日。

`/sql` 的护栏结论：**没有找到「能写数据又能通过检查」的构造**（SQLite 的 DML 必须以自身关键字开头，首词检查卡死了这条路），漏网的四条都不是写入而是资源与信息面。收紧方向是白名单（限表 + 拒递归 CTE），不是往黑名单继续加词。

**改造已落地**（S14~S18），核心是「先剥骨架再检查」：`'...'` 字面量、`--` 与 `/* */` 注释先换成空白，之后所有检查只看骨架——一步同时解决误杀与「注释里藏关键词」。

改造过程中三条对抗实验的产出，都是读代码看不出来的：

1. **`RECURSIVE` 关键字在 SQLite 里可以省**（实测 `WITH c AS (SELECT 1 AS x UNION ALL SELECT x+1 FROM c WHERE x<5)` 直接返回 5）。只查关键字等于没查——最初那版能挡住 bomb 纯属表白名单误打误撞（`c(x)` 的列名表让 CTE 名没被识别）。改成**结构识别**：CTE 体里 `FROM` 了自己即拒。判据放在 `FROM`/`JOIN` 位置而不是全文匹配，否则 `WITH day AS (SELECT day FROM events)` 会被误杀。
2. **`FROM main.events` 这类限定名会被误杀**：正则只抓到 `main`。改成点号后一段参与白名单判定，`main.sqlite_master` 照样拒。
3. **尾部 `--` 注释会吃掉 `maxRows` 包装的收尾括号**（`SELECT * FROM (调用方SQL) LIMIT n` 变成 `... -- 注释) LIMIT n`），正当查询报语法错。包装里补一个换行即可。这条是写测试时才撞出来的，与护栏本身无关。

CTE 影子名（`WITH sqlite_master AS (...) SELECT * FROM sqlite_master`）实测返回 CTE 自身的行，SQLite 里 CTE 优先于真实表，不构成绕过。

## 客户端 eventbase-kt（23 条）

K1~K9、K11、K12、K15~K17、K19、K23 由 PR #2 修复并合并（2026-08-19，39 测试通过）。剩余见下表 ⬜ 行。

| # | 问题 | 来源 | 状态 |
|---|---|---|---|
| K1 | `EventQueue` 非线程安全：`track()` 在锁外改 `ArrayDeque` | 三方 | ✅ 已修（expect/actual `Lock`） |
| K2 | `userId` 在 flush 时才快照 → 匿名期事件被算到登录账号头上 | ultra | ✅ 已修（入队时定格） |
| K3 | `sessionId` 跨进程重启误归因 | ultra | ✅ 已修（入队时定格） |
| K4 | 重复 init 产生两个 `EventQueue` 共用一份 Storage，互相覆盖 → 丢事件 | 三方 | ✅ 已修（install 先到先得 + 锁内原子） |
| K5 | `decode()` 单条坏数据丢掉整个队列 | ultra | ✅ 已修（逐条解析） |
| K6 | `expectSuccess` 开启时 4xx 被判 RETRY → 无效事件永久卡队列 | CR | ✅ 已修（请求级 `expectSuccess = false`） |
| K7 | `onBackground` 的 early return 把 flush 也跳过了 | CR | ✅ 已修（无条件 flush） |
| K8 | `apply()` 异步，强杀丢 install_id / 队列 | 三方 | ✅ 已修（`commit()`） |
| K9 | 重复注册 `ActivityLifecycleCallbacks` | CR + ultra | ✅ 已修（仅 isNew 时注册） |
| K10 | 旋转屏幕切出假会话 | ultra | ⬜ P1 |
| K11 | `onForeground` 非幂等 → iOS 重复回调压缩 `duration_s` | CR | ✅ 已修（幂等） |
| K12 | `userId` 读写非线程安全 | ultra | ✅ 已修（`@Volatile`） |
| K13 | iOS observer token 丢失，无法注销 | ultra + 自审 | ⬜ P1 |
| K14 | `HttpClient` 无超时，卡住占着 flush mutex | CR + 自审 | ⬜ P1 |
| K15 | `props` 未快照，调用方之后改 map 会影响已入队事件 | CR | ✅ 已修（`canonicalProps` 入队即摊平） |
| K16 | `purgeExpired` 只从队头停，时钟回拨会漏清 | CR | ✅ 已修（全量过滤） |
| K17 | `props` 类型往返 Int→Long | CR + 自审 | ✅ 已修（入队即规范化数值类型） |
| K18 | `track()` 全量序列化整个队列，O(n) 落在调用线程 | CR + 自审 | ⬜ P2 |
| K19 | `runCatching` 吞 `CancellationException`（**ultra 否掉、CR 报了**，判 CR 对、影响小） | CR | ✅ 已修（重新抛出） |
| K20 | `AppOpened.isCold` 恒 true，死参数 | ultra | ⬜ P2 |
| K21 | README + Config KDoc 还写着定时 flush | CR + ultra | ⬜ P3 |
| K22 | `QueueTest` 断言扁平化，测不出单批 ≤25 | CR | ⬜ P3 |
| K23 | `BodyTest` 用 `content` 断言，测不出类型回归 | CR | ✅ 已修（改断言类型） |

### 两条要一起看的

**K2 + K3 是同一个根因**：`install`/`session`/`user` 是**批级**字段、在 flush 时取当前值，而事件是过去入队的。不必改协议——`QueuedEvent` 记下入队时的 session/user，flush 时按 `(session, user)` 分组成批即可。一次修两条。

**K10 是设计代价的显形**：当初为守依赖最小集没引 `androidx.lifecycle`，而 `ProcessLifecycleOwner` 内置 700ms 去抖正是为配置变更准备的。要么自己加去抖，要么重新评估那条依赖——**依赖准入已放宽到「业界权威库」可入，androidx 够格**。需单独拍板。

## 处理计划

1. ~~两个仓加 `.coderabbit.yaml`~~ → 本仓已加。**官方 schema 表达不了「仅导出符号」**：`reviews.pre_merge_checks.docstrings` 只有 `mode` / `threshold` 两个字段。故改为 `mode: "off"` 关掉覆盖率门禁，把注释准入写进 `path_instructions`（导出符号要 TSDoc、内部实现豁免、复述性注释反过来提删除）。eventbase-kt 照抄同一份即可；
2. 客户端 P0 八条 → 一个分支 + PR（K2/K3 合并改，K1 用 Channel 串行化）；
3. 客户端 P1 → 一个分支 + PR；服务端 20 条至此**全部关闭**；
4. ~~服务端 S11/S12~~ 已随本批落地；服务端 P1（S13、S14~S18、S19）留作下一轮；
5. 每个 PR 合并前跑本地 `/code-review high`；CodeRabbit 会自动审（base 是 main）。**不再用 ultra**——只剩 1 次免费额度而仓库有两个，不划算。
