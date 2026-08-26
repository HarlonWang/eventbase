-- 设备级标识。**服务端不采集也不推导**，只落客户端显式带上的值——采集与合规申报的
-- 责任在 App 侧（见 docs/protocol.md 的 device 字段）。
ALTER TABLE events ADD COLUMN device_id TEXT;
