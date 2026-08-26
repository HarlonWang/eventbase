-- 设备级标识。服务端不采集也不推导，只落客户端显式带上的值（契约见 docs/protocol.md）。
ALTER TABLE events ADD COLUMN device_id TEXT;
