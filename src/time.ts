// 日界 UTC+8：读数的消费者是产品判断，不是与 cron 对账。见 docs/telemetry-design.md §11.1
const DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

export function dayOf(ms: number): string {
  return new Date(ms + DAY_OFFSET_MS).toISOString().slice(0, 10);
}
