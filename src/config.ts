export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Quotas {
  perInstallPerDay?: number;
  totalPerDay?: number;
}

export interface IngestConfig<TEnv> {
  db: (env: TEnv) => D1Database;
  /** 挂载前缀，如 `/t` → 摄取端点是 `/t/e`。消费方直接 `.fetch()`，不必自建 Hono 做嫁接 */
  basePath?: string;
  /** 未配置则不校验 App-Key：key 是公开的，只用于路由与关停，不是鉴权 */
  appKeys?: (env: TEnv) => readonly string[] | undefined;
  limiter?: (env: TEnv) => RateLimiter | undefined;
  /** 未配置则只校验事件名形状；白名单是可选加固，见 docs/design.md §5.3 */
  allowedEvents?: readonly string[];
  quotas?: Quotas;
  /** 配置后 `user` 以 HMAC 假名落库（events.user_id 与 install_identity 同时生效），原值不进 D1；返回空串视为配置错误、user 丢弃；`device` 不处理 */
  identitySecret?: (env: TEnv) => string | undefined;
}
