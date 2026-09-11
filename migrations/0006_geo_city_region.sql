-- 城市与地区，取自 request.cf。只有服务端事件（source='server'）会填，
-- 客户端摄取路径刻意不写：身份判据只比对登录事件，行为事件无需城市精度。
--
-- 本迁移非幂等：SQLite 的 ALTER TABLE ADD COLUMN 没有 IF NOT EXISTS。
-- 若报 duplicate column name，说明列已存在、本迁移实际已生效，
-- 在 d1_migrations 补一条本文件的记录即可，不要重跑。
ALTER TABLE events ADD COLUMN city TEXT;
ALTER TABLE events ADD COLUMN region TEXT;
