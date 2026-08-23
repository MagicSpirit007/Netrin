-- Read-only verification for 09-route-public-v2-projection-hotfix.sql.
\set ON_ERROR_STOP on

begin read only;

do $$
declare
  v_expected_routes bigint;
  v_public_routes bigint;
  v_expected_points bigint;
  v_public_points bigint;
begin
  if not has_table_privilege('anon', 'public.routes_public_v2', 'select')
    or not has_table_privilege('authenticated', 'public.routes_public_v2', 'select') then
    raise exception 'browser roles lost routes_public_v2 select';
  end if;

  if has_table_privilege('anon', 'public.routes', 'select')
    or has_table_privilege('anon', 'public.route_points', 'select')
    or has_table_privilege('anon', 'public.route_point_media', 'select')
    or has_table_privilege('authenticated', 'public.routes', 'select')
    or has_table_privilege('authenticated', 'public.route_points', 'select')
    or has_table_privilege('authenticated', 'public.route_point_media', 'select') then
    raise exception 'browser role can still read a route base table';
  end if;

  if has_function_privilege(
      'anon', 'public.netrin_point_public_json(public.route_points)', 'execute'
    ) or has_function_privilege(
      'authenticated', 'public.netrin_point_public_json(public.route_points)', 'execute'
    ) then
    raise exception 'internal point helper leaked execute privilege';
  end if;

  select count(*) into v_expected_routes
  from public.routes
  where moderation_status = 'approved' and deleted_at is null;

  select count(*), coalesce(sum(jsonb_array_length(points)), 0)
  into v_public_routes, v_public_points
  from public.routes_public_v2;

  select count(*) into v_expected_points
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where r.moderation_status = 'approved' and r.deleted_at is null;

  if v_public_routes <> v_expected_routes then
    raise exception 'route count mismatch: public %, expected %', v_public_routes, v_expected_routes;
  end if;
  if v_public_points <> v_expected_points then
    raise exception 'point count mismatch: public %, expected %', v_public_points, v_expected_points;
  end if;

  if exists (
    select 1
    from public.routes_public_v2 v
    cross join lateral jsonb_array_elements(v.points) p
    where p ?| array['storagePath', 'storage_path', 'createdBy', 'created_by', 'moderationStatus', 'rejectionReason']
       or exists (
         select 1
         from jsonb_array_elements(coalesce(p -> 'media', '[]'::jsonb)) m
         where m ?| array['storagePath', 'storage_path', 'url']
       )
  ) then
    raise exception 'public route JSON leaks protected fields';
  end if;
end;
$$;

set local role anon;
select count(*) as anon_route_count,
       coalesce(sum(jsonb_array_length(points)), 0) as anon_point_count
from public.routes_public_v2;
reset role;

set local role authenticated;
select count(*) as authenticated_route_count,
       coalesce(sum(jsonb_array_length(points)), 0) as authenticated_point_count
from public.routes_public_v2;
reset role;

rollback;
