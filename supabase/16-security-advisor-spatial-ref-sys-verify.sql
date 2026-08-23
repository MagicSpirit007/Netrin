-- Verification for 16-security-advisor-spatial-ref-sys.sql.
-- Run as supabase_admin, the existing PostGIS extension/table owner.
\set ON_ERROR_STOP on

begin read only;

do $$
declare
  v_transform public.geometry;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'spatial_ref_sys'
      and c.relkind = 'r'
      and c.relrowsecurity
  ) then
    raise exception 'public.spatial_ref_sys RLS is not enabled';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'spatial_ref_sys'
      and policyname = 'spatial_ref_sys_read_only'
      and cmd = 'SELECT'
      and 'public' = any(roles)
  ) then
    raise exception 'spatial_ref_sys read-only policy is missing';
  end if;

  if not exists (
    select 1 from public.spatial_ref_sys where srid = 4326
  ) then
    raise exception 'EPSG:4326 is missing from spatial_ref_sys';
  end if;

  if has_table_privilege('anon', 'public.spatial_ref_sys', 'insert')
    or has_table_privilege('anon', 'public.spatial_ref_sys', 'update')
    or has_table_privilege('anon', 'public.spatial_ref_sys', 'delete')
    or has_table_privilege('authenticated', 'public.spatial_ref_sys', 'insert')
    or has_table_privilege('authenticated', 'public.spatial_ref_sys', 'update')
    or has_table_privilege('authenticated', 'public.spatial_ref_sys', 'delete')
    or has_table_privilege('service_role', 'public.spatial_ref_sys', 'insert')
    or has_table_privilege('service_role', 'public.spatial_ref_sys', 'update')
    or has_table_privilege('service_role', 'public.spatial_ref_sys', 'delete') then
    raise exception 'an API role can mutate spatial_ref_sys';
  end if;

  v_transform := public.st_transform(
    public.st_setsrid(public.st_makepoint(116.397, 39.908), 4326),
    3857
  );
  if v_transform is null or public.st_srid(v_transform) <> 3857 then
    raise exception 'owner ST_Transform control failed';
  end if;
end;
$$;

set local role anon;
select count(*) as anon_epsg_4326
from public.spatial_ref_sys
where srid = 4326;
select public.st_srid(public.st_transform(
  public.st_setsrid(public.st_makepoint(116.397, 39.908), 4326),
  3857
)) as anon_transform_srid;
reset role;

set local role authenticated;
select count(*) as authenticated_epsg_4326
from public.spatial_ref_sys
where srid = 4326;
select public.st_srid(public.st_transform(
  public.st_setsrid(public.st_makepoint(116.397, 39.908), 4326),
  3857
)) as authenticated_transform_srid;
reset role;

set local role service_role;
select count(*) as service_role_epsg_4326
from public.spatial_ref_sys
where srid = 4326;
select public.st_srid(public.st_transform(
  public.st_setsrid(public.st_makepoint(116.397, 39.908), 4326),
  3857
)) as service_role_transform_srid;
reset role;

rollback;
