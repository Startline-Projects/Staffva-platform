-- Step 1 of renaming admin_status 'approved' -> 'live'. Its own file because
-- a new enum label cannot be USED in the transaction that added it — the
-- companion migration that rewrites objects and rows must run separately.
--
-- Applied to production 2026-09-13 via MCP as admin_status_add_live_label.
-- 'approved' deliberately stays in the type afterwards: unused and harmless,
-- and removing an enum value means recreating the type and every dependent.
alter type admin_status_type add value if not exists 'live';
