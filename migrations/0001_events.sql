-- eventbase v1 表结构。设计与取舍见 docs/telemetry-design.md，本文件只记字段语义。
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  INTEGER NOT NULL,               -- 服务端权威时间（UTC ms）
  event_at     INTEGER,                        -- 客户端声明时间，仅用于排序与时钟纠偏
  day          TEXT    NOT NULL,               -- 'YYYY-MM-DD'，UTC+8 日界，按 event_at 计算
  name         TEXT    NOT NULL,
  source       TEXT    NOT NULL,               -- client | server
  install_id   TEXT,
  user_id      TEXT,
  session_id   TEXT,
  flow_id      TEXT,                           -- 跨端漏斗串联，语义与 loginbase 一致
  app_version  TEXT,
  platform     TEXT,                           -- android | ios | server
  channel      TEXT,
  sys_locale   TEXT,
  country      TEXT,                           -- 以下四项取自 Cloudflare 边缘 request.cf
  asn          INTEGER,
  colo         TEXT,
  timezone     TEXT,
  is_debug     INTEGER NOT NULL DEFAULT 0,
  ingest_flags TEXT,                           -- 入口打标：bot / bg_wake / diag / imported
  props        TEXT                            -- JSON
);

-- 索引即写入成本：D1 的 rows written 含索引行，新增前先确认有指标要它。
CREATE INDEX IF NOT EXISTS idx_events_day        ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_name_day   ON events(name, day);
CREATE INDEX IF NOT EXISTS idx_events_install_day ON events(install_id, day);
CREATE INDEX IF NOT EXISTS idx_events_flow       ON events(flow_id);

-- 安装日与首次归因。不物化的话「新增 install」要扫全历史求 min(day)。
CREATE TABLE IF NOT EXISTS install_first_seen (
  install_id  TEXT PRIMARY KEY,
  first_day   TEXT NOT NULL,
  channel     TEXT,
  app_version TEXT,
  platform    TEXT,
  country     TEXT
);

-- 多对多：一机多账号、一号多机都成立。
CREATE TABLE IF NOT EXISTS install_identity (
  install_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (install_id, user_id)
);

-- 对账值与预聚合。读数以 T+2 为准，晚到事件会改写历史日期。
CREATE TABLE IF NOT EXISTS daily_rollup (
  day    TEXT NOT NULL,
  metric TEXT NOT NULL,
  dim    TEXT,
  value  REAL,
  PRIMARY KEY (day, metric, dim)
);

-- 业务维表快照，补跨库 JOIN 消失后的分析能力。
CREATE TABLE IF NOT EXISTS dim_identity_daily (
  day        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  plan       TEXT,
  plan_since INTEGER,
  first_seen INTEGER,
  PRIMARY KEY (day, user_id)
);

-- 日配额计数。限流绑定按 colo 局部计数，跨 colo 的日配额只能落库。
CREATE TABLE IF NOT EXISTS ingest_quota (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (day, key)
);
