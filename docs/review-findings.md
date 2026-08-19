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
| S13 | `n` 参数无边界，`1e12`/`-1`/`1.5` 直接进 SQL | CR | ⬜ P1 |
| S14 | `/sql` 漏网：递归 CTE 炸弹（CPU） | 自审 | ⬜ P1 |
| S15 | `/sql` 漏网：可读 `sqlite_master` | 自审 | ⬜ P1 |
| S16 | `/sql` 漏网：`randomblob` 撑内存 | 自审 | ⬜ P1 |
| S17 | `/sql` 漏网：`load_extension` 未拦 | 自审 | ⬜ P1 |
| S18 | `/sql` 误杀：字符串/注释中含 `update`/`insert` 的正当查询被拒 | 自审 | ⬜ P1 |
| S19 | `tracker` 写入完全静默，「表没建」这类问题不可见 | CR | ⬜ P1（可选 `onError`） |
| S20 | 「恒 204」措辞被误读成「所有拒绝都 204」 | CR（误报） | ⬜ P2 改 protocol.md 措辞，**代码不动** |

S1~S10 由另一个会话自主修复（2026-08-19，43 测试通过）。S5/S7 的补完与 S11/S12 在同一批落地（47 测试通过）。

三条实现决定（与最初提案不同，记在这里免得下次重推）：

- **S5 加列、S7 不加列**。`sys_locale` 首见冻结正是安装归因该有的语义，值得一次迁移；`is_debug` 不加——一台机器可能既跑 debug 又跑正式包，首见冻结会把它永久钉死，改成 debug 批根本不写 `install_first_seen`，分母天然干净且省一次迁移。
- **S11 不做补偿回滚**：补偿本身也会失败，等于回到同一个问题。改成「只读判断 + 记账并入事件的 `db.batch`」——D1 batch 是单事务，配额与事件同生共死，没有新的失败路径。代价只是触顶那一批放行一次，而配额是熔断不是精确计费。
- **S12 顺手把跨批也修了**：`ON CONFLICT DO UPDATE SET first_day = MIN(...)`，否则更早的事件晚到时仍然改不动已冻结的安装日。

`/sql` 的护栏结论：**没有找到「能写数据又能通过检查」的构造**（SQLite 的 DML 必须以自身关键字开头，首词检查卡死了这条路），漏网的四条都不是写入而是资源与信息面。真要收紧，方向是白名单（限表 + 禁 `RECURSIVE` + 扫描行数封顶），不是往黑名单继续加词。

## 客户端 eventbase-kt（23 条，全部待修）

| # | 问题 | 来源 | 级别 |
|---|---|---|---|
| K1 | `EventQueue` 非线程安全：`track()` 在锁外改 `ArrayDeque` | 三方 | **P0** |
| K2 | `userId` 在 flush 时才快照 → 匿名期事件被算到登录账号头上 | ultra | **P0** |
| K3 | `sessionId` 跨进程重启误归因 | ultra | **P0** |
| K4 | 重复 init 产生两个 `EventQueue` 共用一份 Storage，互相覆盖 → 丢事件 | 三方 | **P0** |
| K5 | `decode()` 单条坏数据丢掉整个队列 | ultra | **P0** |
| K6 | `expectSuccess` 开启时 4xx 被判 RETRY → 无效事件永久卡队列 | CR | **P0** |
| K7 | `onBackground` 的 early return 把 flush 也跳过了 | CR | **P0** |
| K8 | `apply()` 异步，强杀丢 install_id / 队列 | 三方 | **P0** |
| K9 | 重复注册 `ActivityLifecycleCallbacks` | CR + ultra | P1 |
| K10 | 旋转屏幕切出假会话 | ultra | P1 |
| K11 | `onForeground` 非幂等 → iOS 重复回调压缩 `duration_s` | CR | P1 |
| K12 | `userId` 读写非线程安全 | ultra | P1 |
| K13 | iOS observer token 丢失，无法注销 | ultra + 自审 | P1 |
| K14 | `HttpClient` 无超时，卡住占着 flush mutex | CR + 自审 | P1 |
| K15 | `props` 未快照，调用方之后改 map 会影响已入队事件 | CR | P1 |
| K16 | `purgeExpired` 只从队头停，时钟回拨会漏清 | CR | P1 |
| K17 | `props` 类型往返 Int→Long | CR + 自审 | P1 |
| K18 | `track()` 全量序列化整个队列，O(n) 落在调用线程 | CR + 自审 | P2 |
| K19 | `runCatching` 吞 `CancellationException`（**ultra 否掉、CR 报了**，判 CR 对、影响小） | CR | P2 |
| K20 | `AppOpened.isCold` 恒 true，死参数 | ultra | P2 |
| K21 | README + Config KDoc 还写着定时 flush | CR + ultra | P3 |
| K22 | `QueueTest` 断言扁平化，测不出单批 ≤25 | CR | P3 |
| K23 | `BodyTest` 用 `content` 断言，测不出类型回归 | CR | P3 |

### 两条要一起看的

**K2 + K3 是同一个根因**：`install`/`session`/`user` 是**批级**字段、在 flush 时取当前值，而事件是过去入队的。不必改协议——`QueuedEvent` 记下入队时的 session/user，flush 时按 `(session, user)` 分组成批即可。一次修两条。

**K10 是设计代价的显形**：当初为守依赖最小集没引 `androidx.lifecycle`，而 `ProcessLifecycleOwner` 内置 700ms 去抖正是为配置变更准备的。要么自己加去抖，要么重新评估那条依赖——**依赖准入已放宽到「业界权威库」可入，androidx 够格**。需单独拍板。

## 处理计划

1. ~~两个仓加 `.coderabbit.yaml`~~ → 本仓已加。**官方 schema 表达不了「仅导出符号」**：`reviews.pre_merge_checks.docstrings` 只有 `mode` / `threshold` 两个字段。故改为 `mode: "off"` 关掉覆盖率门禁，把注释准入写进 `path_instructions`（导出符号要 TSDoc、内部实现豁免、复述性注释反过来提删除）。eventbase-kt 照抄同一份即可；
2. 客户端 P0 八条 → 一个分支 + PR（K2/K3 合并改，K1 用 Channel 串行化）；
3. 客户端 P1 → 一个分支 + PR；
4. ~~服务端 S11/S12~~ 已随本批落地；服务端 P1（S13、S14~S18、S19）留作下一轮；
5. 每个 PR 合并前跑本地 `/code-review high`；CodeRabbit 会自动审（base 是 main）。**不再用 ultra**——只剩 1 次免费额度而仓库有两个，不划算。
