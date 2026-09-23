import type { Format } from "./format.js";

export type Row = Record<string, unknown>;

/** ECharts dataset.source 形态：首行为表头，首列为 x（日期或类目），其余每列一条序列 */
export type Source = (string | number | null)[][];

export type Cell = string | number | null | { text: string; tone: "bad" | "dim" };

export interface TableData {
  columns: (string | { label: string; num?: boolean })[];
  rows: Cell[][];
}

export interface Ctx {
  from: string;
  to: string;
  today: string;
  /** from..to 的完整日期轴，时序卡用它补齐缺失日 */
  days: string[];
  state: Record<string, string | boolean>;
  /** SQL 字符串字面量转义（单引号加倍） */
  esc: (v: unknown) => string;
  addDays: (day: string, n: number) => string;
}

/** 每条 SQL 一组结果，顺序与 sql() 返回一致；单条时写 `([rows]) => …` */
export type Results = Row[][];

export type Foot = string | { text: string; warn: true };

interface CardBase {
  title: string;
  note?: string | ((ctx: Ctx) => string);
  wide?: boolean;
  sql: (ctx: Ctx) => string | string[];
  format?: Format;
}

export interface LineCard extends CardBase {
  type: "line";
  data: (results: Results, ctx: Ctx) => Source;
  yMax?: number;
  foot?: (data: Source, ctx: Ctx, results: Results) => Foot | Foot[] | undefined;
}

export interface BarCard extends CardBase {
  type: "bar";
  data: (results: Results, ctx: Ctx) => Source;
  horizontal?: boolean;
  stack?: boolean;
  /** 仅 horizontal：按行合计降序后保留前 N 行，其余并为 otherLabel */
  topN?: number;
  otherLabel?: string;
  foot?: (data: Source, ctx: Ctx, results: Results) => Foot | Foot[] | undefined;
}

export interface FunnelCard extends CardBase {
  type: "funnel";
  /** 首列步骤名、第二列人数，按步骤顺序 */
  data: (results: Results, ctx: Ctx) => Source;
  foot?: (data: Source, ctx: Ctx, results: Results) => Foot | Foot[] | undefined;
}

export interface TableCard extends CardBase {
  type: "table";
  data: (results: Results, ctx: Ctx) => TableData;
  foot?: (data: TableData, ctx: Ctx, results: Results) => Foot | Foot[] | undefined;
}

export interface HeatmapCard extends CardBase {
  type: "heatmap";
  /** 首列行名（如队列日），表头为列名（如 D1、D7），非数值格留空 */
  data: (results: Results, ctx: Ctx) => Source;
  /** 色阶上限，缺省取格值最大值 */
  max?: number;
  /** tooltip 里跟在行名后的补充说明，如队列人数；row 为 data() 首列转成的字符串（数字行名也是字符串） */
  rowHint?: (row: string, results: Results, ctx: Ctx) => string | undefined;
  foot?: (data: Source, ctx: Ctx, results: Results) => Foot | Foot[] | undefined;
}

export interface MatrixCard extends CardBase {
  type: "matrix";
  /** 长表 [行名, 列名, 值]，由套件透视成二维表；同一格重复出现时累加 */
  data: (results: Results, ctx: Ctx) => [string | number, string | number, unknown][];
  /** 左上角表头，如「国家 / 渠道」 */
  corner?: string;
  /** 合计行与合计列，默认开；比率类数值不可加，应关掉 */
  totals?: boolean;
  /** 行列排序：total 按合计降序（默认），input 按首次出现顺序 */
  order?: "total" | "input";
  foot?: (data: TableData, ctx: Ctx, results: Results) => Foot | Foot[] | undefined;
}

export type CardSpec = LineCard | BarCard | FunnelCard | HeatmapCard | TableCard | MatrixCard;

export interface KpiTile {
  label: string;
  value: unknown;
  format?: Format;
  hint?: string;
  /** 与对照值比较，渲染「↑ 12.3% vs 昨日同时段（25）」；仅 big 布局显示 */
  compare?: { value: unknown; label: string };
}

export interface KpiGroup {
  layout?: "big" | "list";
  sql: (ctx: Ctx) => string | string[];
  tiles: (results: Results, ctx: Ctx) => KpiTile[];
}

export type Option = string | { value: string; label: string };

export interface FilterSpec {
  ranges?: { options: number[]; default: number };
  selects?: {
    key: string;
    /** 未选时的占位文字，如「全部渠道」 */
    label: string;
    options: Option[] | { sql: string; values: (rows: Row[]) => Option[] };
  }[];
  toggles?: { key: string; label: string; default?: boolean }[];
}

export interface DashboardSpec {
  api: { base: string; token: string };
  title: string;
  subtitle?: string;
  /** 页头「最新一条事件到库于 N 前」；at 返回毫秒时间戳 */
  freshness?: { sql: string; at: (results: Results) => number | null };
  links?: { text: string; href: string }[];
  guide?: { summary: string; items: string[] };
  filters?: FilterSpec;
  kpis?: KpiGroup[];
  cards: CardSpec[];
  /** 日界时区，默认 8（与 eventbase 落库的 day 列一致） */
  tzOffsetHours?: number;
  /** 卡片滚到视口附近才取数，默认开；false 时挂载即全部取数 */
  lazy?: boolean;
}
