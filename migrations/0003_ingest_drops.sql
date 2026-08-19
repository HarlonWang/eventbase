-- 摄取端的丢弃计数。恒 204 让丢弃对客户端不可见，服务端自己得留一笔，
-- 否则「丢了多少」这件事我们也答不上来。按天按原因聚合，不带 install 维度（防基数爆炸）。
CREATE TABLE IF NOT EXISTS ingest_drops (
  day    TEXT NOT NULL,
  reason TEXT NOT NULL,   -- invalid | expired | future | unknown_event | quota
  n      INTEGER NOT NULL,
  PRIMARY KEY (day, reason)
);
