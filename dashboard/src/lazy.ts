/** 按可见性调度取数：可见的立刻取；不可见的记为过期，进入视口时再取 */
export function lazyLoader<K>(onShow: (key: K) => void): {
  /** 数据失效（首次加载或筛选变化），返回此刻可见、应立刻取数的那些 */
  invalidate: (keys: readonly K[]) => K[];
  show: (key: K) => void;
  hide: (key: K) => void;
} {
  const visible = new Set<K>();
  const stale = new Set<K>();
  return {
    invalidate(keys) {
      const now: K[] = [];
      for (const k of keys) {
        if (visible.has(k)) {
          stale.delete(k);
          now.push(k);
        } else {
          stale.add(k);
        }
      }
      return now;
    },
    show(key) {
      visible.add(key);
      if (stale.delete(key)) onShow(key);
    },
    hide(key) {
      visible.delete(key);
    },
  };
}
