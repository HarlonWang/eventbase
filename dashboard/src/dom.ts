import { formatter, type Format } from "./format.js";
import type { Foot, TableData } from "./types.js";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function renderTable(host: HTMLElement, data: TableData, format?: Format): void {
  const fmt = formatter(format);
  const cols = data.columns.map((c) => (typeof c === "string" ? { label: c, num: false } : { num: false, ...c }));
  const numeric = cols.map((c, i) => c.num || data.rows.some((r) => typeof r[i] === "number"));
  const table = el("table");
  const head = table.createTHead().insertRow();
  cols.forEach((c, i) => head.appendChild(el("th", numeric[i] ? "num" : "", c.label)));
  const body = table.createTBody();
  for (const row of data.rows) {
    const tr = body.insertRow();
    row.forEach((cell, i) => {
      const td = tr.insertCell();
      if (numeric[i]) td.className = "num";
      if (cell && typeof cell === "object") {
        td.textContent = cell.text;
        td.classList.add(`tone-${cell.tone}`);
      } else {
        td.textContent = typeof cell === "number" ? fmt(cell) : (cell ?? "—");
      }
    });
  }
  host.appendChild(table);
}

export function renderFoot(host: HTMLElement, foot: Foot | Foot[] | undefined): void {
  host.textContent = "";
  const items = foot == null ? [] : Array.isArray(foot) ? foot : [foot];
  items.forEach((f, i) => {
    if (i) host.appendChild(document.createTextNode(" · "));
    host.appendChild(typeof f === "string" ? el("span", "", f) : el("span", "eb-warn", f.text));
  });
  host.hidden = items.length === 0;
}

export function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "不到 1 分钟";
  if (min < 60) return `${min} 分钟`;
  if (min < 48 * 60) return `${Math.round(min / 60)} 小时`;
  return `${Math.round(min / 1440)} 天`;
}
