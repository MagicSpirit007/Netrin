\set ON_ERROR_STOP on

begin read only;

do $$ declare payload text; begin
  if not exists (
    select 1 from public.moderation_events
    where subject_id = 'legacy-contracts'
      and action = 'legacy-contract-removed'
      and note like '%"boundary"%'
      and note like '%"mode"%'
      and note like '%"pwaCycleMarkedAt"%'
  ) then
    raise exception 'legacy removal audit record with gate boundary is missing';
  end if;
  if to_regclass('public.routes_public_v2') is not null or to_regclass('public.routes_owned_v1') is not null then raise exception 'legacy views remain'; end if;
  if to_regclass('netrin_private.routes_public_v2_rm') is not null
    or to_regclass('netrin_private.routes_owned_v1_rm') is not null
    or to_regprocedure('netrin_private.refresh_route_legacy_read_models(uuid)') is not null then
    raise exception 'legacy private read models remain';
  end if;
  if to_regprocedure('public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)') is not null or to_regprocedure('public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb)') is not null then raise exception 'legacy write RPCs remain'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='route_points' and column_name in ('species_name','title')) then raise exception 'legacy point title columns remain'; end if;
  if coalesce((
    select col_description('public.route_points'::regclass, a.attnum)
    from pg_attribute a
    where a.attrelid = 'public.route_points'::regclass
      and a.attname = 'highlight_title'
  ), '') like '%species_name%' then
    raise exception 'highlight_title comment retains legacy dual-write metadata';
  end if;
  if coalesce(obj_description(
    'public.submit_route_v4(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'pg_proc'
  ), '') like '%species_name%' then
    raise exception 'submit_route_v4 comment retains legacy dual-write metadata';
  end if;
  if has_function_privilege('authenticated','public.netrin_submit_route_v3_compat_impl(uuid,jsonb,jsonb,text,jsonb)','execute') then raise exception 'internal rollback implementation is exposed'; end if;
  if to_regclass('public.routes_owned_v2') is null or to_regprocedure('public.submit_route_v4(uuid,jsonb,jsonb,jsonb,jsonb)') is null then raise exception 'current contracts missing'; end if;
  if to_regclass('netrin_private.routes_owned_v2_rm') is not null
    and exists(
      select 1
      from netrin_private.routes_owned_v2_rm r
      cross join lateral jsonb_array_elements(r.points) p
      where p ?| array['title','speciesName']
    ) then
    raise exception 'current route read model retains contracted point fields';
  end if;
  select coalesce(string_agg(public.get_route_detail_v1(r.id)::text,''),'') into payload from public.routes r where r.moderation_status='approved' and r.line_geom is not null and not r.needs_geometry_review;
  if payload like '%speciesName%' or payload like '%storagePath%' or payload like '%created_by%' then raise exception 'public detail leaks removed/internal fields'; end if;
end $$;
select count(*) routes,(select count(*) from public.route_points) points,(select count(*) from public.route_point_media) media from public.routes;

rollback;
