-- 事件幂等 id：客户端生成，用于量化「宁重勿丢」的实际重复率。
-- **刻意先不建唯一索引**：先观察 SELECT event_id, COUNT(*) 的分布，确认重复率
-- 值得治再去重——唯一索引会让重复批次整批 INSERT 失败，那是比重复更糟的后果。
ALTER TABLE events ADD COLUMN event_id TEXT;
