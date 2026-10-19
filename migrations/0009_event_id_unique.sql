-- event_id 唯一索引，配合 INSERT OR IGNORE 实现幂等入库。部分索引：server 事件与不带 id 的
-- 老客户端 event_id 为 NULL，不占索引也不受约束。建索引会为存量每行写一条索引行，计入 D1 日写配额。
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id) WHERE event_id IS NOT NULL;
