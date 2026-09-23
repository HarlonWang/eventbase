import { describe, expect, it } from "vitest";
import { formatter } from "../src/format";
import { barOption, funnelOption, lineOption } from "../src/option";
import { mergeTail } from "../src/source";
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
