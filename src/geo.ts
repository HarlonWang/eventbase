export interface Geo {
  country: string;
  asn: number | null;
  colo: string | null;
  timezone: string | null;
}

const ABSENT: Geo = { country: "unknown", asn: null, colo: null, timezone: null };

/** 取自 Cloudflare 边缘的 request.cf，零外部依赖。是 IP 归属地，不是用户声明位置。 */
export function geoOf(request: Request | undefined): Geo {
  const cf = (request as { cf?: Record<string, unknown> } | undefined)?.cf;
  if (!cf) return ABSENT;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    country: str(cf.country) ?? "unknown",
    asn: typeof cf.asn === "number" ? cf.asn : null,
    colo: str(cf.colo),
    timezone: str(cf.timezone),
  };
}
