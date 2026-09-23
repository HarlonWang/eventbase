import { describe, expect, it } from "vitest";
import { compareText, formatter } from "../src/format";
import { barOption, funnelOption, heatmapHeight, heatmapOption, lineOption } from "../src/option";
import { memoize } from "../src/fetch";
import { mergeTail, pivot, type Triple } from "../src/source";
import { colorScheme, currentMode, isDark, setMode, subscribeMode } from "../src/theme";
import type { Source } from "../src/types";

const days: Source = [["day", "DAU", "新增"], ["2026-09-01", 3, 1], ["2026-09-02", null, 0]];

describe("formatter", () => {
  it("null 与空串显示为 —，0 照常格式化", () => {
    const f = formatter("int");
    expect(f(null)).toBe("—");
    expect(f("")).toBe("—");
    expect(f(0)).toBe("0");
    expect(f(12345.6)).toBe("12,346");
  });

  it("pct 保留一位小数、dur 按量级换单位", () => {
    expect(formatter("pct")(37.54)).toBe("37.5%");
    expect(formatter("dur")(43)).toBe("43s");
    expect(formatter("dur")(600)).toBe("10m");
    expect(formatter("dur")(7200)).toBe("2h");
  });
});

describe("lineOption", () => {
  it("数据走 dataset，序列数 = 列数 - 1，多序列才显示图例", () => {
    const o = lineOption(days) as { dataset: { source: Source }; series: unknown[]; legend: { show: boolean } };
    expect(o.dataset.source).toBe(days);
    expect(o.series).toHaveLength(2);
    expect(o.legend.show).toBe(true);
    const single = lineOption([["day", "v"], ["2026-09-01", 1]]) as { legend: { show: boolean } };
    expect(single.legend.show).toBe(false);
  });

  it("不隐式补 0：null 原样留在 dataset 里", () => {
    const o = lineOption(days) as { dataset: { source: Source } };
    expect(o.dataset.source[2][1]).toBeNull();
  });
});

describe("mergeTail", () => {
  const src: Source = [["name", "n"], ["a", 1], ["b", 5], ["c", 3], ["d", 2]];

  it("按合计降序保留前 N 行，其余求和并成一行", () => {
    expect(mergeTail(src, 2)).toEqual([["name", "n"], ["b", 5], ["c", 3], ["其他（2）", 3]]);
  });

  it("topN 为 0 时全部并入一行", () => {
    expect(mergeTail(src, 0)).toEqual([["name", "n"], ["其他（4）", 11]]);
  });

  it("行数不超过 N 时只排序不合并", () => {
    expect(mergeTail(src, 10)).toEqual([["name", "n"], ["b", 5], ["c", 3], ["d", 2], ["a", 1]]);
  });
});

describe("barOption", () => {
  it("横向时类目在 y 轴且倒序，每条序列 encode 到自己的列", () => {
    const o = barOption([["c", "x", "y"], ["a", 1, 2]], { horizontal: true, stack: true }) as {
      yAxis: { type: string; inverse: boolean };
      series: { encode: { x: number }; stack: string }[];
    };
    expect(o.yAxis).toMatchObject({ type: "category", inverse: true });
    expect(o.series.map((s) => s.encode.x)).toEqual([1, 2]);
    expect(o.series[0].stack).toBe("total");
  });
});

describe("barOption 排序", () => {
  it("横向未设 topN 时也按数值降序", () => {
    const o = barOption([["c", "n"], ["a", 1], ["b", 5]], { horizontal: true }) as { dataset: { source: Source } };
    expect(o.dataset.source.map((r) => r[0])).toEqual(["c", "b", "a"]);
  });

  it("竖向保持原顺序（日期轴）", () => {
    const src: Source = [["day", "n"], ["2026-09-01", 1], ["2026-09-02", 5]];
    expect((barOption(src) as { dataset: { source: Source } }).dataset.source).toBe(src);
  });
});

describe("x 轴日期标签", () => {
  it("非日期类目原样显示，不抛错", () => {
    const o = lineOption([["x", "v"], [1, 2]]) as { xAxis: { axisLabel: { formatter: (d: unknown) => string } } };
    expect(o.xAxis.axisLabel.formatter(1)).toBe("1");
    expect(o.xAxis.axisLabel.formatter("2026-09-01")).toBe("09-01");
  });
});

describe("funnelOption", () => {
  it("标签带占首步百分比，null 显示无数据", () => {
    const o = funnelOption([["step", "n"], ["打开", 200], ["成功", 50], ["未埋点", null]]) as {
      series: { label: { formatter: (p: { value: unknown }) => string } }[];
    };
    const label = o.series[0].label.formatter;
    expect(label({ value: ["打开", 200] })).toBe("200（100%）");
    expect(label({ value: ["成功", 50] })).toBe("50（25%）");
    expect(label({ value: ["未埋点", null] })).toBe("无数据");
  });
});

describe("heatmapOption", () => {
  const cohorts: Source = [["队列", "D1", "D7"], ["2026-09-01", 40, 0], ["2026-09-02", 35.5, null]];
  type H = {
    dataset: { source: unknown[][] };
    xAxis: { data: string[] };
    yAxis: { data: string[]; inverse: boolean };
    visualMap: { max: number };
  };

  it("宽表转长表；null 不出格，0 照常出格", () => {
    const o = heatmapOption(cohorts) as H;
    expect(o.dataset.source).toEqual([
      ["x", "y", "v"], ["D1", "2026-09-01", 40], ["D7", "2026-09-01", 0], ["D1", "2026-09-02", 35.5],
    ]);
  });

  it("行列顺序按宽表，首行在上；色阶上限缺省取最大值，可覆盖", () => {
    const o = heatmapOption(cohorts) as H;
    expect(o.xAxis.data).toEqual(["D1", "D7"]);
    expect(o.yAxis).toMatchObject({ data: ["2026-09-01", "2026-09-02"], inverse: true });
    expect(o.visualMap.max).toBe(40);
    expect((heatmapOption(cohorts, { max: 100 }) as H).visualMap.max).toBe(100);
  });

  it("tooltip 带行名与列名，消费方文本转义后再进 HTML", () => {
    const o = heatmapOption([["c", "D1"], ["<b>", 40]], { format: "pct" }) as {
      tooltip: { formatter: (p: unknown) => string };
    };
    expect(o.tooltip.formatter({ marker: "•", value: ["D1", "<b>", 40] })).toBe("&#60;b&#62;<br>•D1　<b>40%</b>");
  });

  it("全为 null 时色阶上限为 0，不出 -Infinity", () => {
    expect((heatmapOption([["c", "D1"], ["a", null]]) as H).visualMap.max).toBe(0);
  });

  it("数值字符串照常出格；NaN、Infinity、空串不出格", () => {
    const o = heatmapOption([["c", "D1", "D2", "D3", "D4"], ["a", "40", "0", NaN, ""], ["b", Infinity, null, 5, "x"]]) as H;
    expect(o.dataset.source.slice(1)).toEqual([["D1", "a", 40], ["D2", "a", 0], ["D3", "b", 5]]);
  });

  it("全为负数时色阶跟随数据", () => {
    const o = heatmapOption([["c", "D1", "D2"], ["a", -5, -2]]) as { visualMap: { min: number; max: number } };
    expect(o.visualMap).toMatchObject({ min: -5, max: -2 });
  });

  it("行多时加高，行少时不低于默认高度", () => {
    expect(heatmapHeight(cohorts)).toBe(300);
    const many: Source = [["c", "D1"], ...Array.from({ length: 30 }, (_, i) => [`r${i}`, i])];
    expect(heatmapHeight(many)).toBe(30 * 24 + 140);
  });
});

describe("pivot", () => {
  const t: Triple[] = [["US", "organic", 5], ["CN", "organic", 20], ["CN", "ads", 3], ["US", "ads", 10], ["JP", "ads", null]];

  it("行列按合计降序，缺失组合留 null，带合计行列", () => {
    const { data } = pivot(t, { corner: "国家" });
    expect(data.columns).toEqual(["国家", { label: "organic", num: true }, { label: "ads", num: true }, { label: "合计", num: true }]);
    expect(data.rows).toEqual([
      ["CN", 20, 3, 23],
      ["US", 5, 10, 15],
      ["JP", null, null, null],
      ["合计", 25, 13, 38],
    ]);
  });

  it("着色按主体最大值归一，首列、合计与无数据格不着色", () => {
    const { heat } = pivot(t);
    expect(heat[0]).toEqual([null, 1, 0.15, null]);
    expect(heat[2]).toEqual([null, null, null, null]);
    expect(heat[3].every((h) => h === null)).toBe(true);
  });

  it("同一格累加；数值字符串照常计入", () => {
    const { data } = pivot([["a", "x", 1], ["a", "x", "2"]], { totals: false });
    expect(data.rows).toEqual([["a", 3]]);
  });

  it("input 顺序保持首次出现；关掉合计时无合计行列", () => {
    const { data } = pivot(t, { order: "input", totals: false });
    expect(data.rows.map((r) => r[0])).toEqual(["US", "CN", "JP"]);
    expect(data.columns).toHaveLength(3);
  });

  it("整列无数据时列合计为 null 而非 0", () => {
    const { data } = pivot([["a", "x", 1], ["a", "y", null]]);
    expect(data.rows.at(-1)).toEqual(["合计", 1, null, 1]);
  });

  it("空输入不出合计行", () => {
    expect(pivot([]).data.rows).toEqual([]);
  });
});

describe("配色模式", () => {
  it("跟随系统时看系统，手动选择时无视系统", () => {
    expect(isDark("auto", true)).toBe(true);
    expect(isDark("auto", false)).toBe(false);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });

  it("html 的 color-scheme：跟随系统时两者都声明", () => {
    expect(colorScheme("auto")).toBe("light dark");
    expect(colorScheme("dark")).toBe("dark");
  });
});

describe("配色是页面级共享状态", () => {
  it("任一实例切换时全部收到通知；最后一个退订才还原 <html>", () => {
    const html = { style: { colorScheme: "normal" } };
    (globalThis as { document?: unknown }).document = { documentElement: html };
    const seen: string[] = [];
    const offA = subscribeMode(() => seen.push(`A:${currentMode()}`));
    const offB = subscribeMode(() => seen.push(`B:${currentMode()}`));
    expect(html.style.colorScheme).toBe("light dark");

    setMode("dark");
    expect(seen).toEqual(["A:dark", "B:dark"]);
    expect(html.style.colorScheme).toBe("dark");

    offB();
    offB();
    expect(html.style.colorScheme).toBe("dark");
    offA();
    expect(html.style.colorScheme).toBe("normal");
    delete (globalThis as { document?: unknown }).document;
  });
});

describe("同批次 SQL 去重", () => {
  it("文本相同只请求一次，各调用方拿到独立的数组", async () => {
    const calls: string[] = [];
    const run = memoize(async (sql) => {
      calls.push(sql);
      return [{ n: 2 }, { n: 1 }];
    });
    const [a, b, c] = await Promise.all([run("SELECT 1"), run("SELECT 1"), run("SELECT 2")]);
    expect(calls).toEqual(["SELECT 1", "SELECT 2"]);
    a.sort((x, y) => Number(x.n) - Number(y.n));
    expect(b.map((r) => r.n)).toEqual([2, 1]);
    expect(c).toHaveLength(2);
  });
});

describe("KPI 涨跌幅", () => {
  it("涨跌带方向、一位小数与对照绝对值", () => {
    expect(compareText(21, 25, "昨日同时段")).toEqual({ text: "↓ 16% vs 昨日同时段（25）", dir: "down" });
    expect(compareText(30, 25, "昨日同时段")).toEqual({ text: "↑ 20% vs 昨日同时段（25）", dir: "up" });
    expect(compareText(1234, 1000, "x").text).toBe("↑ 23.4% vs x（1,000）");
  });

  it("持平不上色；对照为 0 或缺失只给 —", () => {
    expect(compareText(25, 25, "x")).toEqual({ text: "持平 vs x（25）", dir: null });
    expect(compareText(5, 0, "x")).toEqual({ text: "— vs x", dir: null });
    expect(compareText(5, null, "x")).toEqual({ text: "— vs x", dir: null });
  });

  it("空串按缺失处理，与 formatter 显示「—」一致", () => {
    expect(compareText("", 25, "x")).toEqual({ text: "— vs x", dir: null });
    expect(compareText(25, " ", "x")).toEqual({ text: "— vs x", dir: null });
  });

  it("对照值为负时百分比仍为正，方向看大小", () => {
    expect(compareText(-20, -25, "x")).toEqual({ text: "↑ 20% vs x（-25）", dir: "up" });
    expect(compareText(-30, -25, "x")).toEqual({ text: "↓ 20% vs x（-25）", dir: "down" });
  });
});
