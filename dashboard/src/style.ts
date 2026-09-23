const CSS = `
.eb { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 1440px; margin: 0 auto; padding: 16px; }
.eb h1 { font-size: 20px; margin: 0; }
.eb-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.eb-tools { margin-left: auto; display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.eb-tools button[aria-pressed="true"] { font-weight: 700; }
.eb-muted { opacity: .65; font-size: 12px; }
.eb-guide { margin: 10px 0 0; }
.eb-guide ol { margin: 6px 0; padding-left: 22px; }
.eb-box { border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 8px; padding: 12px 14px; }
.eb-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 14px 0; }
.eb-kpi-v { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.eb-delta { font-size: 12px; opacity: .75; font-variant-numeric: tabular-nums; }
.eb-delta.eb-up { color: #188038; opacity: 1; }
.eb-delta.eb-down { color: #d93025; opacity: 1; }
.eb-kpi-list { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-variant-numeric: tabular-nums; }
.eb-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 14px 0; }
.eb-filters button[aria-pressed="true"] { font-weight: 700; }
.eb-filters label { display: inline-flex; align-items: center; gap: 4px; }
.eb-stamp { margin-left: auto; }
.eb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(460px, 100%), 1fr)); gap: 14px; }
.eb-card { min-width: 0; }
.eb-card.wide { grid-column: 1 / -1; }
.eb-card h2 { font-size: 15px; margin: 0; display: inline; }
.eb-card .eb-muted { margin-left: 8px; }
.eb-chart { height: 300px; }
.eb-table { max-height: 340px; overflow: auto; margin-top: 8px; }
.eb-table table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.eb-table th, .eb-table td { padding: 5px 8px; white-space: nowrap; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); text-align: left; }
.eb-table th { position: sticky; top: 0; background: Canvas; font-weight: 500; color: color-mix(in srgb, currentColor 70%, Canvas); }
.eb-table .num { text-align: right; }
.eb-foot { font-size: 12px; opacity: .7; margin-top: 6px; }
.eb-empty { padding: 40px 0; text-align: center; opacity: .6; }
.eb-error { color: #d93025; }
.eb-warn, .tone-bad { color: #d93025; }
.tone-dim { opacity: .55; }
.eb-loading { opacity: .5; transition: opacity .15s; }
`;

export function injectStyle(): void {
  if (document.getElementById("eb-style")) return;
  const s = document.createElement("style");
  s.id = "eb-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}
