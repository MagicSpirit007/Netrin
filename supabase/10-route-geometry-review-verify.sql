-- Run after 10-route-geometry-review.sql. Read-only verification.
do $$
declare definition text;
begin
  if to_regprocedure('public.get_my_account_v1()') is null
    or has_function_privilege('anon','public.get_my_account_v1()','EXECUTE')
    or not has_function_privilege('authenticated','public.get_my_account_v1()','EXECUTE') then
    raise exception 'my-account projection contract invalid';
  end if;
  if to_regprocedure('public.admin_confirm_route_geometry_v1(uuid,boolean,text,text,jsonb,jsonb,text)') is null then
    raise exception 'admin_confirm_route_geometry_v1 missing';
  end if;
  select pg_get_functiondef('public.admin_confirm_route_geometry_v1(uuid,boolean,text,text,jsonb,jsonb,text)'::regprocedure)
    into definition;
  if position('security definer' in lower(definition)) = 0 or position('set search_path' in lower(definition)) = 0 then
    raise exception 'security definer/search_path contract missing';
  end if;
  if has_function_privilege('anon', 'public.admin_confirm_route_geometry_v1(uuid,boolean,text,text,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'anon must not execute geometry review';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_confirm_route_geometry_v1(uuid,boolean,text,text,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'authenticated grant missing (runtime admin check still applies)';
  end if;
end $$;

select 'legacy_geometry_gate' as check_name,
  count(*) filter (where needs_geometry_review = true) as still_needs_review,
  count(*) filter (where needs_geometry_review = false and line_geom is not null) as confirmed_navigable,
  count(*) filter (where needs_geometry_review = false and line_geom is null) as invalid_promotions
from public.routes
where moderation_status = 'approved' and deleted_at is null;

select id, author, title, needs_geometry_review,
  line_geom is not null as has_geometry, travel_mode, geometry_source, updated_at
from public.routes
where moderation_status = 'approved' and deleted_at is null
order by created_at, id;

-- R1 activation requires exactly one audited conclusion per historical route under review.
select subject_id, action, note, created_at, actor_id
from public.moderation_events
where subject_type = 'route'
  and action in ('geometry-confirmed-navigable', 'geometry-confirmed-not-navigable')
order by created_at, id;
