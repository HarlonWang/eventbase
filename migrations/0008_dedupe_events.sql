-- 清存量重复：同一 event_id 只留最早入库的一行。2026-10 实测重复率约 10%（来源见 protocol.md「幂等 id」）。
-- 幂等，可重跑。与 0009 拆成两个文件沿用「一个迁移一条语句」惯例。
--
-- 上线顺序：先部署带 INSERT OR IGNORE 的代码，再 apply 本迁移与 0009。
-- 若 0008 与 0009 之间又进了重复行导致 0009 建索引失败，手动重跑本文件的语句后再 apply 一次即可。
DELETE FROM events
 WHERE event_id IS NOT NULL
   AND id NOT IN (SELECT MIN(id) FROM events WHERE event_id IS NOT NULL GROUP BY event_id);
