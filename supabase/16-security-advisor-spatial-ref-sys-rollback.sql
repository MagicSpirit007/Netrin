-- Emergency behavioral rollback for 16-security-advisor-spatial-ref-sys.sql.
-- Read grants are intentionally retained because spatial_ref_sys is public CRS
-- metadata and PostGIS callers may depend on them.
-- Run as supabase_admin, the existing PostGIS extension/table owner.
\set ON_ERROR_STOP on

begin;

drop policy if exists spatial_ref_sys_read_only on public.spatial_ref_sys;
alter table public.spatial_ref_sys disable row level security;

comment on table public.spatial_ref_sys is
  'PostGIS spatial reference system catalog.';

commit;

notify pgrst, 'reload schema';
