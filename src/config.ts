export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Quotas {
  perInstallPerDay?: number;
  totalPerDay?: number;
}

export interface IngestConfig<TEnv> {
  db: (env: TEnv) => D1Database;
  /** 未配置则不校验 App-Key：key 是公开的，只用于路由与关停，不是鉴权 */
  appKeys?: (env: TEnv) => readonly string[] | undefined;
  limiter?: (env: TEnv) => RateLimiter | undefined;
  /** 未配置则只校验事件名形状；白名单是可选加固，见 docs/design.md §5.3 */
  allowedEvents?: readonly string[];
  quotas?: Quotas;
}
