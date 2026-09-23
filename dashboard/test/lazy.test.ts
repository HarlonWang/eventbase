import { describe, expect, it } from "vitest";
import { lazyLoader } from "../src/lazy";

describe("lazyLoader", () => {
  it("首次加载：此刻不可见的全部记为过期，一个都不取", () => {
    const shown: string[] = [];
    const l = lazyLoader<string>((k) => shown.push(k));
    expect(l.invalidate(["a", "b", "c"])).toEqual([]);
    expect(shown).toEqual([]);
  });

  it("过期的卡进入视口时取一次，再次进入不重复取", () => {
    const shown: string[] = [];
    const l = lazyLoader<string>((k) => shown.push(k));
    l.invalidate(["a", "b"]);
    l.show("b");
    l.hide("b");
    l.show("b");
    expect(shown).toEqual(["b"]);
  });

  it("筛选变化时可见的立刻取，不可见的等滚到再取", () => {
    const shown: string[] = [];
    const l = lazyLoader<string>((k) => shown.push(k));
    l.invalidate(["a", "b"]);
    l.show("a");
    expect(l.invalidate(["a", "b"])).toEqual(["a"]);
    expect(shown).toEqual(["a"]);
    l.show("b");
    expect(shown).toEqual(["a", "b"]);
  });

  it("立刻取过的卡随后进入视口不会再取", () => {
    const shown: string[] = [];
    const l = lazyLoader<string>((k) => shown.push(k));
    l.show("a");
    expect(l.invalidate(["a"])).toEqual(["a"]);
    l.hide("a");
    l.show("a");
    expect(shown).toEqual([]);
  });
});
