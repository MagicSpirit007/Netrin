-- Netrin Security Advisor hardening: PostGIS spatial_ref_sys.
--
-- This keeps the PostGIS extension in public, enables RLS on its catalog table,
-- preserves read-only CRS metadata, and blocks browser/service roles from writes.
-- Run manually on the self-hosted server after a verified PostgreSQL backup:
--   docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
--     < 16-security-advisor-spatial-ref-sys.sql
-- spatial_ref_sys is owned by supabase_admin in the self-hosted PostGIS image;
-- do not change its owner merely to run this migration.
--
-- The AI CLI must not run this migration over SSH.
\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('public.spatial_ref_sys') is null then
    raise exception 'public.spatial_ref_sys is missing; PostGIS preflight failed';
  end if;
end;
$$;

alter table public.spatial_ref_sys enable row level security;

drop policy if exists spatial_ref_sys_read_only on public.spatial_ref_sys;
create policy spatial_ref_sys_read_only
on public.spatial_ref_sys
for select
to public
using (true);

-- EPSG/CRS rows are public reference metadata. Keep reads available, but ensure
-- no Data API role can mutate the extension-owned catalog even if grants drift.
grant select on public.spatial_ref_sys to anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
  on public.spatial_ref_sys
  from public, anon, authenticated, service_role;

comment on table public.spatial_ref_sys is
  'PostGIS CRS catalog. RLS is enabled; standard reference rows are read-only to API roles.';

commit;

notify pgrst, 'reload schema';
