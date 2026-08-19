-- 首见时冻结 locale：locale 会变，但安装归因要的正是首见值。
ALTER TABLE install_first_seen ADD COLUMN sys_locale TEXT;
