-- Netrin M7 contract. Destructive: run only after the documented backups.
-- Hard gates: >=30 days since the observation start/last successful legacy write,
-- and an administrator-recorded PWA update cycle after observation began.
-- Early execution is explicitly opt-in and one-time. The default run keeps the
-- original 30-day zero-write gate. To run early, pass all three variables:
--   -v netrin_sql14_early=true
--   -v netrin_sql14_early_reason='<reason>'
--   -v netrin_sql14_early_authorized_by='<authorization record>'
-- The early path still requires a registered PWA cycle after observation start
-- and zero legacy usage rows; it only bypasses the 30-day wait.
\set ON_ERROR_STOP on
\if :{?netrin_sql14_early}
\else
  \set netrin_sql14_early false
\endif
\if :{?netrin_sql14_early_reason}
\else
  \set netrin_sql14_early_reason ''
\endif
\if :{?netrin_sql14_early_authorized_by}
\else
  \set netrin_sql14_early_authorized_by ''
\endif

begin;

select set_config('netrin.sql14.early', :'netrin_sql14_early', true);
select set_config('netrin.sql14.early_reason', :'netrin_sql14_early_reason', true);
select set_config('netrin.sql14.early_authorized_by', :'netrin_sql14_early_authorized_by', true);

do $$ declare v_started timestamptz; v_cycle timestamptz; v_last timestamptz;
           v_call_count bigint;
           v_early boolean := current_setting('netrin.sql14.early', true)::boolean;
           v_reason text := trim(current_setting('netrin.sql14.early_reason', true));
           v_authorized_by text := trim(current_setting('netrin.sql14.early_authorized_by', true));
begin
  if exists (select 1 from public.moderation_events where subject_id = 'legacy-contracts' and action = 'legacy-contract-removed') then
    raise exception 'legacy contract removal was already recorded';
  end if;
  select started_at,pwa_cycle_marked_at into v_started,v_cycle from public.legacy_contract_observation where singleton for update;
  if v_started is null then raise exception 'legacy observation was not started'; end if;
  if v_cycle is null or v_cycle < v_started then raise exception 'PWA update cycle gate not satisfied'; end if;
  select count(*), max(last_called_at) into v_call_count, v_last from public.legacy_contract_usage;
  if coalesce(v_last, v_started) > v_started then
    raise exception 'legacy writes observed after observation start; last write %', v_last;
  end if;
  if v_early then
    if v_call_count <> 0 then
      raise exception 'early execution requires zero legacy contract usage rows; found %', v_call_count;
    end if;
    if char_length(v_reason) not between 12 and 1000 then
      raise exception 'early execution requires a 12-1000 character netrin_sql14_early_reason';
    end if;
    if v_authorized_by = '' or char_length(v_authorized_by) > 500 then
      raise exception 'early execution requires netrin_sql14_early_authorized_by';
    end if;
  else
    if v_reason <> '' or v_authorized_by <> '' then
      raise exception 'early reason/authorization requires -v netrin_sql14_early=true';
    end if;
    if greatest(v_started, coalesce(v_last, v_started)) > now() - interval '30 days' then
      raise exception '30-day zero-write window not satisfied; last boundary %', greatest(v_started, coalesce(v_last, v_started));
    end if;
  end if;
  perform set_config('netrin.sql14.observation_started', coalesce(v_started::text, ''), true);
  perform set_config('netrin.sql14.pwa_cycle_marked', coalesce(v_cycle::text, ''), true);
  perform set_config('netrin.sql14.last_legacy_write', coalesce(v_last::text, ''), true);
end $$;

-- Replace dual-write/dual-read helpers before dropping legacy point columns.
create or replace function public.netrin_replace_route_points(p_route_id uuid,p_points jsonb,p_owner_id uuid,p_enforce_owner_path boolean)
returns void language plpgsql security definer set search_path=''
as $$ declare
  pr record; mr record; pt jsonb; md jsonb; point_id uuid; media_id uuid;
  lng double precision; lat double precision; media_path text; expected_prefix text; highlight text; category text;
begin
  if p_points is null or jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points) not between 2 and 200 then raise exception 'route needs between 2 and 200 points'; end if;
  update public.routes set cover_media_id=null where id=p_route_id;
  delete from public.route_points where route_id=p_route_id;
  for pr in select value item,ordinality::integer ordinal from jsonb_array_elements(p_points) with ordinality loop
    pt:=pr.item; point_id:=coalesce(nullif(pt->>'id','')::uuid,gen_random_uuid());
    if jsonb_typeof(pt->'lng')<>'number' or jsonb_typeof(pt->'lat')<>'number' then raise exception 'point coordinates must be numbers'; end if;
    lng:=(pt->>'lng')::double precision; lat:=(pt->>'lat')::double precision;
    if lng not between -180 and 180 or lat not between -90 and 90 then raise exception 'point coordinate out of range'; end if;
    if jsonb_typeof(coalesce(pt->'media','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(pt->'media','[]'::jsonb))>8 then raise exception 'point media must be an array with at most 8 images'; end if;
    highlight:=public.netrin_point_highlight_title(pt); category:=nullif(trim(coalesce(pt->>'category','')),'');
    if category is not null and char_length(category)>80 then raise exception 'point category must be at most 80 characters'; end if;
    insert into public.route_points(id,route_id,sort_order,location,highlight_title,category,note)
    values(point_id,p_route_id,pr.ordinal,public.st_setsrid(public.st_makepoint(lng,lat),4326),highlight,category,left(coalesce(pt->>'text',''),4000));
    for mr in select value item,ordinality::integer ordinal from jsonb_array_elements(coalesce(pt->'media','[]'::jsonb)) with ordinality loop
      md:=mr.item; media_id:=coalesce(nullif(md->>'id','')::uuid,gen_random_uuid()); media_path:=md->>'storagePath';
      if p_enforce_owner_path then expected_prefix:=format('routes/%s/%s/%s/',p_owner_id,p_route_id,point_id); if media_path is null or position(expected_prefix in media_path)<>1 then raise exception 'media path does not belong to route owner'; end if;
      elsif media_path is null or position('routes/' in media_path)<>1 then raise exception 'invalid route media path'; end if;
      insert into public.route_point_media(id,point_id,sort_order,storage_path,mime_type,width,height)
      values(media_id,point_id,mr.ordinal,media_path,coalesce(md->>'mimeType','image/jpeg'),nullif(md->>'width','')::integer,nullif(md->>'height','')::integer);
    end loop;
  end loop;
end $$;
revoke all on function public.netrin_replace_route_points(uuid,jsonb,uuid,boolean) from public,anon,authenticated;

create or replace function public.netrin_point_public_json(p public.route_points)
returns jsonb language sql stable set search_path=''
as $$ select jsonb_build_object(
  'id',p.id,'order',p.sort_order,'lng',public.st_x(p.location),'lat',public.st_y(p.location),
  'text',p.note,'highlightTitle',nullif(p.highlight_title,''),'category',p.category,
  'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'order',m.sort_order,'mimeType',m.mime_type,'width',m.width,'height',m.height) order by m.sort_order) from public.route_point_media m where m.point_id=p.id),'[]'::jsonb)
) $$;
revoke all on function public.netrin_point_public_json(public.route_points) from public,anon,authenticated;

create or replace function public.netrin_point_admin_json(p public.route_points)
returns jsonb language sql stable set search_path=''
as $$ select jsonb_build_object(
  'id',p.id,'order',p.sort_order,'lng',public.st_x(p.location),'lat',public.st_y(p.location),
  'text',p.note,'highlightTitle',nullif(p.highlight_title,''),'category',p.category,
  'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'order',m.sort_order,'storagePath',m.storage_path,'mimeType',m.mime_type,'width',m.width,'height',m.height) order by m.sort_order) from public.route_point_media m where m.point_id=p.id),'[]'::jsonb)
) $$;
revoke all on function public.netrin_point_admin_json(public.route_points) from public,anon,authenticated;

drop view if exists public.routes_public_v2;
drop view if exists public.routes_owned_v1;

-- SQL17 keeps legacy compatibility in non-exposed RLS read models. Remove those
-- models only after the same observation gates above pass. The queue processor
-- calls the legacy refresh helper dynamically, so current projections continue
-- to refresh after this helper is removed.
do $$
begin
  if to_regnamespace('netrin_private') is not null then
    execute 'drop function if exists netrin_private.refresh_route_legacy_read_models(uuid)';
    execute 'drop table if exists netrin_private.routes_public_v2_rm';
    execute 'drop table if exists netrin_private.routes_owned_v1_rm';
  end if;
end;
$$;

drop function if exists public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb);
drop function if exists public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb);
revoke all on function public.netrin_submit_route_v3_compat_impl(uuid,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
alter table public.route_points drop column if exists species_name,drop column if exists title;

comment on column public.route_points.highlight_title is
  'Canonical route highlight title after the legacy point-title contract was removed.';
comment on function public.submit_route_v4(uuid,jsonb,jsonb,jsonb,jsonb) is
  'Idempotent route submit with travelMode/geometry/meta. Persists canonical highlight_title point data. Phone-confirmed active accounts only.';

-- SQL17 current route read models materialize point JSON. Rebuild them after
-- the helper and legacy columns contract so no removed field remains cached.
do $$
declare
  v_id uuid;
begin
  if to_regprocedure(
    'netrin_private.refresh_route_current_read_models(uuid)'
  ) is not null then
    for v_id in select id from public.routes loop
      perform netrin_private.refresh_route_current_read_models(v_id);
    end loop;
  end if;
end;
$$;

insert into public.moderation_events(actor_id,subject_type,subject_id,action,note)
values(null,'account','legacy-contracts','legacy-contract-removed',
  jsonb_build_object(
    'mode', case when current_setting('netrin.sql14.early', true)::boolean then 'early' else '30-day' end,
    'reason', nullif(current_setting('netrin.sql14.early_reason', true), ''),
    'authorizedBy', nullif(current_setting('netrin.sql14.early_authorized_by', true), ''),
    'observationStartedAt', current_setting('netrin.sql14.observation_started', true),
    'pwaCycleMarkedAt', current_setting('netrin.sql14.pwa_cycle_marked', true),
    'lastLegacyWriteAt', nullif(current_setting('netrin.sql14.last_legacy_write', true), ''),
    'boundary', case when current_setting('netrin.sql14.early', true)::boolean
      then 'explicit authorization; PWA cycle marked; zero legacy usage rows'
      else '30-day window; PWA cycle marked; no legacy writes inside window'
    end
  )::text);
commit;
notify pgrst,'reload schema';
