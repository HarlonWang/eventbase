# eventbase

多 App 共用的埋点底座（客户端上报 + 服务端事件 + D1 明细 + 取数接口）。**开工前先读 README.md 和 `docs/design.md`**——路线、拓扑、接入形态全在里面；指标与数据模型见 `docs/telemetry-design.md`（L1~L4 分层定稿，含事件命名规范）；两端契约见 `docs/protocol.md`（唯一权威）；替换 Aptabase 的背景与迁移面见 `docs/migration-from-aptabase.md`。

**本仓是 public。**只放通用能力与脱敏后的结论；任何消费方 App 的读数、词汇、业务表名、生产域名一律记在其私有仓。

## 关联仓库（本仓库外的消费方与邻居）

| 仓库 | 角色 |
|---|---|
| 业务 Worker 仓（私有） | **首个消费方**：裸 JS Worker，`/t/*` 挂载摄取端；埋点落独立 D1，业务库不动 |
| [TrendingAI](https://github.com/HarlonWang/TrendingAI) | 客户端消费方，替换 Aptabase；其事件词汇表住私有父仓，本仓不持有 |
| [eventbase-kt](https://github.com/HarlonWang/eventbase-kt) | **姊妹仓**：KMP 客户端库，独立版本线与 CI；协议以本仓 `docs/protocol.md` 为唯一权威，客户端仓不留副本 |
| [loginbase](https://github.com/HarlonWang/loginbase) | 邻居 + 将来的消费方：把本库列为 peerDependency，登录事件写进埋点库，其 `auth_events` 退役 |
| 私有父仓 | 决策记录的出处，业务读数最终归属地 |

## 铁律

### 依赖准入

与 loginbase 同一套（2026-08-18 一并定）。允许三类，其余先停下来问值不值：

1. **现有基座**——hono（peer）+ 必要时的 zod-validator；
2. **业界权威库**——生态事实标准、组织或多人维护、发布节奏稳定；
3. **自己的库**（`HarlonWang/*`）——在库里优先声明为 peerDependency。

拒绝：为省几十行代码的工具包、单人维护的新包、运行时联网的包、为一个功能拖进整个框架的包。

### 注释密度护栏

`npm run lint:comments`——注释行 / 总行 ≤ 15%，单函数内注释 ≤ 2 行。超阈值会让 CI 红，改注释或改文件拆分，不要改阈值。

### 其他

- **协议变更**：实现 + `docs/protocol.md` 必须同一个 commit，同时在 `eventbase-kt` 仓开跟进 issue，客户端版本落地前不关。两仓各自独立版本线，tag 为裸版本号。
- **埋点绝不能成为业务的故障源**：服务端写入 `waitUntil` + 吞一切异常；摄取端对拒绝与丢弃恒返回 204，避免客户端把拒收当重试信号；存储故障返回 5xx，由客户端留队列重试。
- **生产库里有一条冒烟数据**（`channel='smoke'`）：取数与分析时一律排除。
