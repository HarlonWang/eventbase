# eventbase

多 App 共用的埋点底座（客户端上报 + 服务端事件 + D1 明细 + 取数接口）。**开工前先读 README.md 和 `docs/design.md`**——路线、拓扑、接入形态全在里面；指标与数据模型见 `docs/telemetry-design.md`（L1~L4 分层定稿，含事件词汇）；两端契约见 `docs/protocol.md`（唯一权威）；替换 Aptabase 的背景与迁移面见 `docs/migration-from-aptabase.md`。

`docs/trendingai-notes.md` 含业务读数与内部口径，**本仓转 public 前须整份移回私有父仓 TrendingProjects**。

## 关联仓库（本仓库外的消费方与邻居）

| 路径 | 角色 |
|---|---|
| `/Users/wanghl/TrendingProjects/github-ai-trending-api` | **首个消费方**：裸 JS Worker，`/t/*` 挂载摄取端；埋点落独立 D1（`trending-events`），业务库不动 |
| `/Users/wanghl/TrendingProjects/TrendingAI` | 客户端消费方：约 130 个调用点要按新词汇重构，替换 Aptabase |
| `/Users/wanghl/eventbase-kt` | **姊妹仓**：KMP 客户端库，独立版本线与 CI；协议以本仓 `docs/protocol.md` 为唯一权威，客户端仓不留副本 |
| `/Users/wanghl/loginbase` | 邻居 + 将来的消费方：把本库列为 peerDependency，登录事件写进埋点库，其 `auth_events` 退役 |
| `/Users/wanghl/TrendingProjects` | 私有父仓：决策记录的出处，业务读数最终归属地 |

## 铁律

### 依赖准入

与 loginbase 同一套（2026-08-18 一并定）。允许三类，其余先停下来问值不值：

1. **现有基座**——hono（peer）+ 必要时的 zod-validator；
2. **业界权威库**——四条判据全满足：① 生态事实标准、组织或多人维护、发布节奏稳定；② 发布带 provenance / trusted publishing；③ 传递依赖 ≤ 2 且同样满足 ①；④ 无安装脚本；
3. **自己的库**（`HarlonWang/*`）——同样走 trusted publishing，在库里优先声明为 peerDependency。

拒绝：为省几十行代码的工具包、单人维护的新包、运行时联网或带安装脚本的包、为一个功能拖进整个框架的包。

### 注释准入

**「为什么」写进 docs，「是什么」靠命名，注释只留「反直觉」。**

只有四类注释允许存在：

| 类型 | 说明 |
|---|---|
| 反直觉的约束 | `// period 只能 10 或 60：Workers 限流绑定的硬限制` |
| 外部契约 | `// 25 条上限须与 protocol.md 同步` |
| 踩坑记录 | 一行 + 日期 |
| 公共 API 的 TSDoc | 只写「是什么 / 参数 / 返回」，不写「为什么这么设计」 |

禁止：复述代码、把设计论证抄进源码、解释语言机制、分节横幅注释（该拆文件了）。**任何超过 3 行的解释性注释一律改成一行指针**（`// 见 docs/telemetry-design.md#离线队列`）。

量化护栏：`npm run lint:comments`——注释行 / 总行 ≤ 15%，单函数内注释 ≤ 2 行。超阈值会让 CI 红，改注释或改文件拆分，不要改阈值。

**边界**：本规则只适用于 `eventbase` 与 `eventbase-kt` 两仓。改动消费方（TrendingAI / github-ai-trending-api）时沿用各自仓库的既有风格。

### 其他

- **协议变更**：实现 + `docs/protocol.md` 必须同一个 commit，同时在 `eventbase-kt` 仓开跟进 issue，客户端版本落地前不关。两仓各自独立版本线，tag 为裸版本号。
- **埋点绝不能成为业务的故障源**：服务端写入 `waitUntil` + 吞一切异常；摄取端恒返回 204（含拒绝与丢弃），避免客户端把失败当重试信号。
- **词汇是唯一权威**：新增或修改事件先改 `docs/telemetry-design.md` 的词汇表，禁止在调用点就地发明事件名。语义变了就用新事件名，绝不复用旧名。

## 当前状态

**设计定稿、实现未开始**（2026-08-18 建仓）。仓库为 private 起步，第一版发包前审查 `docs/trendingai-notes.md` 的去留再决定是否转 public。
