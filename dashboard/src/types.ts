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

export type CardSpec = LineCard | BarCard | FunnelCard | TableCard;

export interface KpiTile {
  label: string;
  value: unknown;
  format?: Format;
  hint?: string;
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
}
