const DAY_MS = 86400e3;

export function todayOf(tzOffsetHours: number, now = Date.now()): string {
  return new Date(now + tzOffsetHours * 3600e3).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
