# 看板套件设计

> 状态：**已拍板，待实施**（2026-09-23）。落地时同步改 `design.md` §6.1 产物表与 `telemetry-design.md`「v1 不做看板 UI」两处。

## 1. 定位

一个浏览器端套件：消费方写一份**看板规格**（筛选、KPI、卡片、每张卡的 SQL），套件负责取数、渲染、交互。

动机：现有两份看板（TrendingAI 与一个私有消费方）是同一份手写 SVG 代码的两个拷贝，已各自演化出 140 行以上的图表层差异，同一类 bug 要修两遍、且修不齐。

原则：**按 ECharts 官方做法来，不迁就旧页面的画法；先简化，再逐项加回**（§8 待办）。

| 做 | 不做 |
|---|---|
| 取数客户端、筛选、KPI、五种卡片、深浅色、自适应宽度 | SQL 口径（归消费方） |
| | 自定义主题 / 视觉调校：ECharts 默认风格 |
| | 数据延迟提示（T+N 未定稿、「iOS 未到」） |
| | 取数鉴权模型（沿用 admin token，页面如何持有 token 归消费方） |

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 渲染层用 **ECharts**，默认风格，深色用内置 `dark` 主题 | Apache 顶级项目，开源健康度在候选（Plot / Chart.js / Vega-Lite / uPlot / ApexCharts）里最好 |
| D2 | 套件**住本仓** `dashboard/`，随 npm 包 `@whlong/eventbase` 一起发版 | 套件只服务 eventbase 的取数面，版本与 `/q/sql` 绑在一起 |
| D3 | 分发走 jsDelivr 的 npm 通道，消费方页面**无构建**直接 `import` | 保持「一个 HTML 就能跑」 |
| D4 | ECharts 不进 `dependencies`：页面用 `<script>` 钉版本加载，套件读全局 `echarts`；本仓只列为 devDependency 取类型 | Worker 侧消费方安装本包时不被拖进前端库 |
| D5 | 套件**不认识业务列、不做 SQL 生成器**；筛选条件由消费方写成普通函数 | 两家卫生条件差异大，抽象出来会变成第二套口径语言 |
| D6 | **不做隐式补 0**：`null` = 无数据（断线），`0` = 真的是 0，由消费方在 `data()` 里决定 | 补 0 会把「没数据」画成「掉到 0」 |

## 3. 分层

```
消费方 HTML（私有仓）
  └─ 看板规格：筛选定义、KPI、卡片清单、SQL、口径文案
        │
        ▼
@whlong/eventbase/dashboard（本仓）
  ├─ 数据层：sql() 客户端、并发加载与过期丢弃、按卡隔离的错误
  ├─ 规格层：spec → ECharts option / DOM 参数
  └─ 渲染层：ECharts（line / bar / funnel）+ DOM（table / KPI / 筛选）
```

## 4. 看板规格

### 4.1 顶层

```ts
mount(el, {
  api: { base: "https://…/t/q", token },
  title: "…",
  freshness?: { sql, value: (row) => Date },    // 页头「最新一条事件到库于 X 前」
  links?: [{ text, href }],
  guide?: { summary, items: string[] },         // 「读数前必读」折叠块
  filters: FilterSpec,
  kpis?: KpiSpec[],
  cards: CardSpec[],
});
```

### 4.2 筛选

```ts
filters: {
  ranges: { options: [7, 14, 30], default: 14 },
  selects: [{ key, label, options: [...] | { sql, value } }],  // 静态或启动时查一次
  toggles: [{ key, label, default: false }],
}
```

卡片的 SQL 拿到筛选状态自己拼：

```ts
sql: (ctx) => `SELECT … WHERE day BETWEEN '${ctx.from}' AND '${ctx.to}' AND ${myWhere(ctx)}`
// ctx = { from, to, days: string[], today, state: { … }, esc }
```

### 4.3 KPI

```ts
kpis: [
  { type: "value", label: "DAU（今日）", sql, value: (r) => r.dau, filtered: true },
  { type: "list", sql, rows: [{ label, value, format }], filtered: false },
]
```

- 只展示**今日实时值**，不展示昨日、不做较前日变化：今日是不完整的一天，与完整的前一天比较没有意义。
- `filtered` 决定是否吃筛选。

### 4.4 卡片

```ts
{
  id, title, note?, wide?: boolean,
  type: "line" | "bar" | "funnel" | "table",
  sql: (ctx) => string | string[],          // 多条并发，rows 按序传入 data()
  data: (rows, ctx) => Source,               // ECharts dataset.source 形态：首行为表头的二维数组
  format?: "int" | "pct" | "dur" | (v) => string,
  foot?: (source, ctx) => (string | { text, warn: true })[],
  // 类型专属
  horizontal?: boolean, stack?: boolean, topN?: number,   // bar
  yMax?: number,                                           // line
}
```

每张卡**独立取数、独立报错**：一条 SQL 失败只让该卡显示错误。空数据统一显示「区间内无数据」。

### 4.5 组件

| 类型 | 渲染 | 用于 |
|---|---|---|
| `line` | ECharts line，`tooltip.trigger: 'axis'` | 趋势：活跃与新增、会话时长、渗透率 |
| `bar` | ECharts bar；`horizontal` 时按数值降序、`topN` 之外并为「其他」；`stack` 堆叠 | 构成随时间、类目分布、按类目的结果构成 |
| `funnel` | `bar` 的预设：横向、按步骤顺序、标签「人数（占首步 %）」 | 登录 / 注册 / 订阅漏斗 |
| `table` | DOM 表格，单元格可为 `{ text, tone: "bad" \| "dim" }`，超高内滚动 | 队列留存、明细、排行、多组对比 |
| KPI | DOM | §4.3 |

不用 ECharts `funnel` 系列：梯形读不出步间比例。

## 5. ECharts 用法约定

- 数据走 `dataset` + `encode`，不手拼 `series.data`。
- `legend`、`tooltip`、`grid.containLabel` 用默认组件；`toolbox` 开 `dataView`（看数据表）与 `saveAsImage`。
- `aria.enabled: true`。
- 每个图表容器挂 `ResizeObserver` → `chart.resize()`。
- 刷新数据 `setOption(option, { notMerge: true })`。
- `prefers-color-scheme` 变化时 `dispose()` 后以 `dark` 主题重建。

## 6. 运行时

筛选变化 → 所有卡片 SQL 并发 → 过期响应丢弃（序号比对）→ 各卡独立渲染。

## 7. 工程

```
dashboard/
  src/            # TS，DOM lib，与 Worker 侧 src/ 分开的 tsconfig
  test/           # spec → ECharts option 的纯函数测试（node 环境，不走 workers pool）
  example.html    # 最小可跑页面，同时是消费方模板
```

- 构建产物 `dist/dashboard/*.js`（ESM），`package.json` 加 `exports["./dashboard"]`。
- 消费方引用：

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js"></script>
<script type="module">
  import { mount } from "https://cdn.jsdelivr.net/npm/@whlong/eventbase@0.7.0/dist/dashboard/index.js";
  mount(document.getElementById("app"), { /* 规格 */ });
</script>
```

- 注释密度检查的 `ROOTS` 加上 `dashboard/src`、`dashboard/test`。
- 调试期间消费方可把 import 指向本地起的 `dist/`，不必每次发版。

## 8. 实施与待办

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | 套件核心 + 五种组件；TrendingAI 全部卡片按新形态迁完，旧 `dashboard.html` 删除 | 同一套 SQL 下新旧数字一致；拖动窗口宽度不失真；深浅色切换正常；控制台无报错 |
| P2 | 卡片「SQL」按钮；私有消费方迁移并部署 | 同上 |

**待办**（逐项评估后再加）：样本量提示、版本发布标注、留存热力图、矩阵表（如国家 × 渠道）、多组漏斗共用基准、卡片视图切换（榜 ↔ 趋势）。
