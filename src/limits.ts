// 协议契约，改动须与 docs/protocol.md 同一个 commit。
export const LIMITS = {
  batchEvents: 25,
  bodyBytes: 64 * 1024,
  eventName: 60,
  eventIdChars: 36,
  propKeys: 20,
  propKeyChars: 40,
  propValueChars: 180,
  futureMs: 10 * 60 * 1000,
  pastMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export const EVENT_NAME_RE = /^[a-z][a-z0-9_]*$/;
