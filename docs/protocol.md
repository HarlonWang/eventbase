# eventbase 上报协议

> **本文是两端的唯一权威**：服务端实现与本文必须同一个 commit 落地，客户端仓不留副本。
> 变更须同时在 [eventbase-kt](https://github.com/HarlonWang/eventbase-kt) 开跟进 issue，客户端版本落地前不关。
>
> 版本 **0.1（草案）**——实现尚未开始，字段仍可调整。设计依据见 `telemetry-design.md` §12。

## 端点

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| `POST` | `<prefix>/e` | `App-Key` 头（公开，可反编译，仅用于路由与开关） | 批量上报 |
| `GET` | `<queryPrefix>/` | `Authorization: Bearer <admin token>` | 取数索引（自描述：可用指标、切片轴、用法） |
| `GET` | `<queryPrefix>/m/:metric` | 同上 | 固定指标 |
| `POST` | `<queryPrefix>/sql` | 同上 | 受限单条 SELECT / WITH |

前缀由消费方挂载时决定，TrendingAI 用 `/t`（摄取）与 `/t/q`（取数）。摄取与取数是两个 factory：`createIngest` 与 `createQuery`，可分别挂载或只挂其一。

## 取数

| 参数 | 说明 |
|---|---|
| `from` / `to` | `YYYY-MM-DD`，默认最近 14 天 |
| `by` | 切片轴，白名单：`channel` / `platform` / `app_version` / `sys_locale` / `country`。**按指标可用**：`active` / `new_installs` 支持全部五项（`new_installs` 用首见时冻结的值）；`events` 与 `retention` 暂不支持切片（dim 位分别被事件名与队列占用）。指标不支持的轴返回 400，不静默返回未切片的数 |
| `name` | 仅 `events` 指标：按事件名过滤 |
| `n` | 仅 `retention` 指标：第 N 日回访，默认 1 |

v1 指标：`active`（当日活跃 install 去重）、`new_installs`（安装日队列）、`events`（按事件名计数）、`retention`（安装日队列的第 N 日回访）。

`POST /sql` 的护栏：单条语句（含 `;` 即拒）、必须以 `SELECT` 或 `WITH` 开头、写类关键字一律拒、结果封顶 `maxRows`（默认 1000，超出截断并返回 `truncated: true`）。**未配置 `adminToken` 时整个取数面返回 404**——宁可没有这个面，也不要一个没有门的读接口。

## 上报请求体

```jsonc
{
  "install": "uuid-v4",          // 必填，安装级标识，卸载重装才变
  "session": "uuid-v4",          // 必填，客户端生成
  "user": "identity-id",         // 可选，登录后带上
  "sys": {
    "version": "1.3.0",          // app 版本
    "platform": "android",       // android | ios
    "channel": "play",
    "locale": "zh-Hans-CN",      // 完整 BCP-47
    "debug": false
  },
  "events": [
    {
      "name": "content_opened",  // ≤ 60 字符，snake_case
      "at": 1755500000000,       // 客户端时间，UTC ms
      "flow": "uuid-v4",         // 可选，跨端漏斗串联
      "props": { "source": "github", "rank": 3 }
    }
  ]
}
```

## 限制

| 项 | 值 | 超限行为 |
|---|---|---|
| 单批事件数 | ≤ 25 | 整个请求 400 |
| body 体积 | ≤ 64 KB | 413 |
| 事件名 | ≤ 60 字符 | 丢该条 |
| props 键数 | ≤ 20 | 丢该条 |
| props 键长 | ≤ 40 字符 | 丢该条 |
| props 字符串值 | 截断至 180 字符 | 截断，不丢 |
| `at` 未来 | > 10 分钟 | 丢该条 |
| `at` 过期 | > 7 天 | 丢该条 |
| 限流 | 每 install 60 秒 60 条；每 IP 60 秒 600 条 | 丢弃，仍返回 204 |
| 日配额 | 每 install 2000；全局 50 万 | 丢弃，仍返回 204。记账与事件写入同批提交，**触顶的那一批放行一次，下一批才拦** |

单条无效**只丢那条**，其余照收。

## 响应语义

**成功路径恒返回 `204`**，不区分「已入库」与「被丢弃」。这是刻意的：客户端只要收到 204 就出队，不重试。

| 状态 | 客户端行为 |
|---|---|
| `204` | 出队 |
| `4xx` | 出队（服务端已判定无效，重试无意义） |
| `5xx` / 网络错误 | 保留在队列，指数退避重试 |

**不使用 `429`**——它会诱发重试，与限流的目的相反。

## 时间语义

| 字段 | 含义 |
|---|---|
| `event_at` | 客户端声明时间，即请求里的 `at`；只用于排序与时钟纠偏 |
| `received_at` | 服务端接收时间，**分析默认用它** |
| `day` | `'YYYY-MM-DD'`，**按 `event_at` 以 UTC+8 日界计算** |
| `first_day` | install 的安装日，取该 install 已接受事件里**最小的 `day`**；晚到的更早事件会把它改小。`sys.debug` 为 true 的批不写入此表 |

`day` 取 `event_at` 而非 `received_at`，否则离线补报会被记到上报当天，活跃日与留存队列失真。代价是历史日期的数字会被晚到事件追加修改，故**读数以 T+2 为准**。

## 客户端队列约定

| 参数 | 值 |
|---|---|
| 队列上限 | 500 条，满了丢最老 |
| 自清窗口 | 出队前丢弃 `at` 超过 7 天的事件（与服务端拒收窗口同一个数） |
| flush 时机 | 进后台、攒够阈值、或定时 |

## 服务端事件

同一张表，`source='server'`，不经 HTTP：消费方在自己的 Worker 里用 `createTracker({ db })` 直接写 D1。地理六项取自 `request.cf`，因此 writer 必须能拿到请求上下文。

判据：**漏斗末端落在业务库的，一律补发 server 事件，不靠跨库 JOIN**。

## 兼容策略

- 新增可选字段：不算破坏性变更，客户端可不升级；
- 事件语义变更：**用新事件名**，绝不复用旧名；
- 破坏性变更：服务端在一个版本内同时接受新旧形状，客户端全量升级后再移除。
