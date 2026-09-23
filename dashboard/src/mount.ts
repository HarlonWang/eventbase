import type { ECharts, EChartsOption } from "echarts";
import { ago, el, renderFoot, renderTable } from "./dom.js";
import { formatter } from "./format.js";
import { barOption, funnelOption, lineOption } from "./option.js";
import { injectStyle } from "./style.js";
import { colorScheme, isDark, loadMode, saveMode, THEME_MODES } from "./theme.js";
import { addDays, dayList, todayOf } from "./time.js";
import type { CardSpec, Ctx, DashboardSpec, KpiGroup, Option, Results, Row, Source, TableData } from "./types.js";

declare const echarts: typeof import("echarts");

interface CardView {
  spec: CardSpec;
  root: HTMLElement;
  note: HTMLElement;
  chart: HTMLElement;
  table: HTMLElement;
  empty: HTMLElement;
  error: HTMLElement;
  foot: HTMLElement;
}

async function runSql(api: DashboardSpec["api"], sql: string): Promise<Row[]> {
  const res = await fetch(`${api.base.replace(/\/+$/, "")}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${res.status === 401 ? "（token 无效）" : ""} ${body.slice(0, 200)}`);
  }
  return ((await res.json()) as { rows: Row[] }).rows;
}

function chartOption(spec: CardSpec, source: Source): EChartsOption {
  switch (spec.type) {
    case "line": return lineOption(source, spec);
    case "bar": return barOption(source, spec);
    default: return funnelOption(source, spec);
  }
}

const optionOf = (o: Option) => (typeof o === "string" ? { value: o, label: o } : o);

export function mount(root: HTMLElement, spec: DashboardSpec): { reload: () => Promise<void>; destroy: () => void } {
  if (typeof echarts === "undefined") throw new Error("eventbase dashboard: 先用 <script> 加载 ECharts");
  injectStyle();
  const tz = spec.tzOffsetHours ?? 8;
  const filters = spec.filters ?? {};
  const state: Record<string, string | boolean> = {};
  for (const s of filters.selects ?? []) state[s.key] = "";
  for (const t of filters.toggles ?? []) state[t.key] = t.default ?? false;
  let range = filters.ranges?.default ?? 14;
  const runAll = (q: string | string[]): Promise<Results> => Promise.all([q].flat().map((s) => runSql(spec.api, s)));

  root.classList.add("eb");
  root.textContent = "";
  const head = root.appendChild(el("header", "eb-head"));
  head.appendChild(el("h1", "", spec.title));
  if (spec.subtitle) head.appendChild(el("span", "eb-muted", spec.subtitle));
  const fresh = head.appendChild(el("span", "eb-muted"));
  const tools = head.appendChild(el("div", "eb-tools"));
  for (const l of spec.links ?? []) Object.assign(tools.appendChild(el("a", "", l.text)), { href: l.href });
  const themeGroup = tools.appendChild(el("div"));
  themeGroup.setAttribute("role", "group");
  themeGroup.setAttribute("aria-label", "配色");
  if (spec.guide) {
    const d = root.appendChild(el("details", "eb-guide eb-box"));
    d.appendChild(el("summary", "", spec.guide.summary));
    const ol = d.appendChild(el("ol"));
    for (const item of spec.guide.items) ol.appendChild(el("li", "", item));
  }
  const kpiRoot = root.appendChild(el("section", "eb-kpis"));
  const bar = root.appendChild(el("div", "eb-filters"));
  const banner = root.appendChild(el("div", "eb-error"));
  banner.hidden = true;
  const grid = root.appendChild(el("main", "eb-grid"));

  const charts = new Map<HTMLElement, { inst: ECharts; option: EChartsOption }>();
  const dark = matchMedia("(prefers-color-scheme: dark)");
  let mode = loadMode();
  const theme = () => (isDark(mode, dark.matches) ? "dark" : undefined);
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) charts.get(e.target as HTMLElement)?.inst.resize();
  });
  const retheme = () => {
    for (const [node, c] of charts) {
      c.inst.dispose();
      c.inst = echarts.init(node, theme());
      c.inst.setOption(c.option);
    }
  };
  const onSystemChange = () => {
    if (mode === "auto") retheme();
  };
  dark.addEventListener("change", onSystemChange);
  const html = document.documentElement;
  const prevScheme = html.style.colorScheme;
  html.style.colorScheme = colorScheme(mode);
  for (const { mode: m, label } of THEME_MODES) {
    const b = themeGroup.appendChild(el("button", "", label));
    b.type = "button";
    b.setAttribute("aria-pressed", String(m === mode));
    b.addEventListener("click", () => {
      if (m === mode) return;
      mode = m;
      saveMode(m);
      html.style.colorScheme = colorScheme(m);
      for (const x of themeGroup.children) x.setAttribute("aria-pressed", String(x === b));
      retheme();
    });
  }
  const draw = (node: HTMLElement, option: EChartsOption) => {
    let c = charts.get(node);
    if (!c) {
      c = { inst: echarts.init(node, theme()), option };
      charts.set(node, c);
      ro.observe(node);
    }
    c.option = option;
    c.inst.setOption(option, { notMerge: true });
  };

  const cards: CardView[] = spec.cards.map((c) => {
    const box = grid.appendChild(el("section", `eb-box eb-card${c.wide ? " wide" : ""}`));
    const h = box.appendChild(el("header"));
    h.appendChild(el("h2", "", c.title));
    const view: CardView = {
      spec: c,
      root: box,
      note: h.appendChild(el("span", "eb-muted")),
      chart: box.appendChild(el("div", "eb-chart")),
      table: box.appendChild(el("div", "eb-table")),
      empty: box.appendChild(el("div", "eb-empty", "区间内无数据")),
      error: box.appendChild(el("div", "eb-error")),
      foot: box.appendChild(el("div", "eb-foot")),
    };
    for (const n of [view.chart, view.table, view.empty, view.error, view.foot]) n.hidden = true;
    return view;
  });

  const renderCard = (v: CardView, results: Results, ctx: Ctx) => {
    const s = v.spec;
    if (s.type === "table") {
      const data: TableData = s.data(results, ctx);
      v.table.textContent = "";
      v.table.hidden = data.rows.length === 0;
      v.empty.hidden = !v.table.hidden;
      if (data.rows.length) renderTable(v.table, data, s.format);
      renderFoot(v.foot, s.foot?.(data, ctx, results));
      return;
    }
    const source = s.data(results, ctx);
    const empty = source.length < 2;
    v.chart.hidden = empty;
    v.empty.hidden = !empty;
    if (!empty) draw(v.chart, chartOption(s, source));
    renderFoot(v.foot, s.foot?.(source as never, ctx, results));
  };

  const renderKpis = (host: HTMLElement, g: KpiGroup, results: Results, ctx: Ctx) => {
    host.textContent = "";
    const tiles = g.tiles(results, ctx);
    if (g.layout === "list") {
      const list = host.appendChild(el("div", "eb-box")).appendChild(el("div", "eb-kpi-list"));
      for (const t of tiles) {
        list.appendChild(el("span", "", t.label));
        list.appendChild(el("b", "", formatter(t.format)(t.value)));
      }
      return;
    }
    for (const t of tiles) {
      const box = host.appendChild(el("div", "eb-box"));
      box.appendChild(el("div", "eb-muted", t.label));
      box.appendChild(el("div", "eb-kpi-v", formatter(t.format)(t.value)));
      if (t.hint) box.appendChild(el("div", "eb-muted", t.hint));
    }
  };
  const kpiHosts = (spec.kpis ?? []).map(() => {
    const host = kpiRoot.appendChild(el("div"));
    host.style.display = "contents";
    return host;
  });
  kpiRoot.hidden = kpiHosts.length === 0;

  let seq = 0;
  const ctxNow = (): Ctx => {
    const to = todayOf(tz);
    const from = addDays(to, -(range - 1));
    return {
      from, to, today: to, days: dayList(from, to), state: { ...state },
      esc: (v) => String(v).replace(/'/g, "''"),
      addDays,
    };
  };

  async function reload(): Promise<void> {
    const my = ++seq;
    const ctx = ctxNow();
    for (const v of cards) {
      const n = v.spec.note;
      v.note.textContent = typeof n === "function" ? n(ctx) : (n ?? "");
    }
    const failures: string[] = [];
    const guard = async (task: () => Promise<void>, onError: (msg: string) => void) => {
      try {
        await task();
      } catch (e) {
        if (my !== seq) return;
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(msg);
        onError(msg);
      }
    };
    const tasks = [
      ...cards.map((v) => guard(async () => {
        v.root.classList.add("eb-loading");
        const results = await runAll(v.spec.sql(ctx)).finally(() => v.root.classList.remove("eb-loading"));
        if (my !== seq) return;
        v.error.hidden = true;
        renderCard(v, results, ctx);
      }, (msg) => {
        v.error.textContent = `取数失败：${msg}`;
        v.error.hidden = false;
        v.chart.hidden = v.table.hidden = v.empty.hidden = v.foot.hidden = true;
      })),
      ...(spec.kpis ?? []).map((g, i) => guard(async () => {
        const results = await runAll(g.sql(ctx));
        if (my === seq) renderKpis(kpiHosts[i], g, results, ctx);
      }, (msg) => {
        kpiHosts[i].textContent = "";
        kpiHosts[i].appendChild(el("div", "eb-box eb-error", `取数失败：${msg}`));
      })),
    ];
    if (spec.freshness) {
      const f = spec.freshness;
      tasks.push(guard(async () => {
        const at = f.at(await runAll(f.sql));
        if (my === seq) fresh.textContent = at == null ? "" : `最新一条事件到库于 ${ago(at)}前`;
      }, () => { fresh.textContent = ""; }));
    }
    await Promise.all(tasks);
    if (my !== seq) return;
    banner.hidden = failures.length === 0;
    banner.textContent = failures.length ? `${failures.length} 处取数失败：${failures[0]}` : "";
    stamp.textContent = `已刷新 ${new Date().toLocaleTimeString("zh-CN")}`;
  }

  if (filters.ranges) {
    const group = bar.appendChild(el("div"));
    group.setAttribute("role", "group");
    for (const d of filters.ranges.options) {
      const b = group.appendChild(el("button", "", `${d} 天`));
      b.type = "button";
      b.setAttribute("aria-pressed", String(d === range));
      b.addEventListener("click", () => {
        range = d;
        for (const x of group.children) x.setAttribute("aria-pressed", String(x === b));
        void reload();
      });
    }
  }
  for (const s of filters.selects ?? []) {
    const sel = bar.appendChild(el("select"));
    sel.setAttribute("aria-label", s.label);
    sel.appendChild(el("option", "", s.label)).value = "";
    const fill = (opts: Option[]) => {
      for (const o of opts.map(optionOf)) sel.appendChild(el("option", "", o.label)).value = o.value;
    };
    if (Array.isArray(s.options)) fill(s.options);
    else {
      const src = s.options;
      runSql(spec.api, src.sql).then((rows) => fill(src.values(rows))).catch(() => {});
    }
    sel.addEventListener("change", () => {
      state[s.key] = sel.value;
      void reload();
    });
  }
  for (const t of filters.toggles ?? []) {
    const label = bar.appendChild(el("label"));
    const box = label.appendChild(el("input"));
    box.type = "checkbox";
    box.checked = Boolean(state[t.key]);
    label.appendChild(document.createTextNode(t.label));
    box.addEventListener("change", () => {
      state[t.key] = box.checked;
      void reload();
    });
  }
  const stamp = bar.appendChild(el("span", "eb-muted eb-stamp"));

  void reload();
  const destroy = () => {
    seq++;
    dark.removeEventListener("change", onSystemChange);
    html.style.colorScheme = prevScheme;
    ro.disconnect();
    for (const c of charts.values()) c.inst.dispose();
    charts.clear();
    root.textContent = "";
  };
  return { reload, destroy };
}
