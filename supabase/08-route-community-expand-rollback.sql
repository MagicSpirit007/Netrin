-- 移步换景 / Netrin M1 route-community expand ROLLBACK (behavioral).
--
-- Restores pre-08 public entry points and legacy v3/publish/admin contracts.
-- DATA-PRESERVING: does NOT drop columns, rows, indexes, or M1 constraints.
-- highlight_title / category / line_geom / tags / cover / needs_geometry_review
-- and all backfilled values remain. Dual-write point helper is retained so
-- later legacy writes cannot blank highlight_title defaults.
--
-- After this script, rerunning 08-route-community-expand.sql must succeed.
--
-- Manual command:
--   docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
--     < 08-route-community-expand-rollback.sql
--
-- The AI CLI must not run this migration over SSH.

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop M1 public entry points (dependency-safe). Schema/data retained.
-- ---------------------------------------------------------------------------

drop function if exists public.get_route_detail_v1(uuid);
drop function if exists public.submit_route_v4(uuid, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.routes_discovery_v1(
  timestamptz, uuid, integer, text, text, integer, integer, integer, integer, text, text[],
  double precision, double precision, double precision, double precision
);

-- Drop dependent views before recreating JSON helpers they reference.
drop view if exists public.routes_discovery_v1;
drop view if exists public.routes_owned_v2;
drop view if exists public.routes_public_v2;
drop view if exists public.routes_admin_v1;
drop view if exists public.routes_owned_v1;

-- Keep internal helpers required by retained constraints / dual-write:
--   netrin_route_tags_valid, netrin_point_highlight_title,
--   netrin_replace_route_points (dual-write), netrin_point_*_json rebuild below,
--   netrin_route_bbox_json (numeric) may remain unused by legacy projections.
-- Drop apply/parse only if nothing else depends; safe to drop v4-only helpers.
drop function if exists public.netrin_apply_route_meta(uuid, jsonb);
drop function if exists public.netrin_parse_line_geom(jsonb);

-- ---------------------------------------------------------------------------
-- 2. Restore legacy outward JSON helpers (speciesName dual-read still OK)
-- ---------------------------------------------------------------------------

drop function if exists public.netrin_point_public_json(public.route_points);
drop function if exists public.netrin_point_admin_json(public.route_points);

create or replace function public.netrin_point_public_json(p public.route_points)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'order', p.sort_order,
    'lng', public.st_x(p.location),
    'lat', public.st_y(p.location),
    'title', p.title,
    'text', p.note,
    'speciesName', nullif(coalesce(nullif(p.species_name, ''), p.highlight_title), ''),
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'order', m.sort_order,
          'mimeType', m.mime_type,
          'width', m.width,
          'height', m.height
        ) order by m.sort_order
      )
      from public.route_point_media m
      where m.point_id = p.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.netrin_point_public_json(public.route_points)
  from public, anon, authenticated;

create or replace function public.netrin_point_admin_json(p public.route_points)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'order', p.sort_order,
    'lng', public.st_x(p.location),
    'lat', public.st_y(p.location),
    'title', p.title,
    'text', p.note,
    'speciesName', nullif(coalesce(nullif(p.species_name, ''), p.highlight_title), ''),
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'order', m.sort_order,
          'storagePath', m.storage_path,
          'mimeType', m.mime_type,
          'width', m.width,
          'height', m.height
        ) order by m.sort_order
      )
      from public.route_point_media m
      where m.point_id = p.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.netrin_point_admin_json(public.route_points)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Restore legacy public / admin / owned-v1 projections
-- ---------------------------------------------------------------------------

drop view if exists public.routes_public_v2;
create view public.routes_public_v2
with (security_invoker = off) as
select
  r.id,
  r.author,
  r.title,
  r.description,
  r.downloads,
  r.likes,
  r.created_at,
  coalesce((
    select jsonb_agg(public.netrin_point_public_json(p) order by p.sort_order)
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.moderation_status = 'approved' and r.deleted_at is null;

revoke all on public.routes_public_v2 from anon, authenticated;
grant select on public.routes_public_v2 to anon, authenticated;

drop view if exists public.routes_admin_v1;
create view public.routes_admin_v1
with (security_invoker = off) as
select
  r.id, r.created_by, r.author, r.title, r.description, r.moderation_status,
  r.rejection_reason, r.created_at, r.updated_at, r.reviewed_at, r.reviewed_by,
  coalesce((
    select jsonb_agg(public.netrin_point_admin_json(p) order by p.sort_order)
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where public.netrin_is_admin();

revoke all on public.routes_admin_v1 from anon, authenticated;
grant select on public.routes_admin_v1 to authenticated;

drop view if exists public.routes_owned_v1;
create view public.routes_owned_v1
with (security_invoker = off) as
select id, title, description, moderation_status, rejection_reason, created_at, updated_at
from public.routes
where created_by = auth.uid();

revoke all on public.routes_owned_v1 from anon, authenticated;
grant select on public.routes_owned_v1 to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Retain dual-write replace helper (do NOT recreate species-only blanking).
--    Clear cover FK before cascade so ON DELETE SET NULL is not required mid-loop.
-- ---------------------------------------------------------------------------

create or replace function public.netrin_replace_route_points(
  p_route_id uuid,
  p_points jsonb,
  p_owner_id uuid,
  p_enforce_owner_path boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_point_record record;
  v_media_record record;
  v_point jsonb;
  v_media jsonb;
  v_point_id uuid;
  v_media_id uuid;
  v_lng double precision;
  v_lat double precision;
  v_path text;
  v_expected_prefix text;
  v_highlight text;
  v_category text;
begin
  if p_points is null or jsonb_typeof(p_points) <> 'array'
    or jsonb_array_length(p_points) < 2 or jsonb_array_length(p_points) > 200 then
    raise exception 'route needs between 2 and 200 points';
  end if;

  update public.routes set cover_media_id = null where id = p_route_id;
  delete from public.route_points where route_id = p_route_id;

  for v_point_record in
    select value as item, ordinality::integer as ordinal
    from jsonb_array_elements(p_points) with ordinality
  loop
    v_point := v_point_record.item;
    v_point_id := coalesce(nullif(v_point ->> 'id', '')::uuid, gen_random_uuid());
    if jsonb_typeof(v_point -> 'lng') <> 'number' or jsonb_typeof(v_point -> 'lat') <> 'number' then
      raise exception 'point coordinates must be numbers';
    end if;
    v_lng := (v_point ->> 'lng')::double precision;
    v_lat := (v_point ->> 'lat')::double precision;
    if v_lng not between -180 and 180 or v_lat not between -90 and 90 then
      raise exception 'point coordinate out of range';
    end if;
    if jsonb_typeof(coalesce(v_point -> 'media', '[]'::jsonb)) <> 'array' then
      raise exception 'point media must be an array';
    end if;
    if jsonb_array_length(coalesce(v_point -> 'media', '[]'::jsonb)) > 8 then
      raise exception 'a point may contain at most 8 images';
    end if;

    v_highlight := public.netrin_point_highlight_title(v_point);
    v_category := nullif(trim(coalesce(v_point ->> 'category', '')), '');
    if v_category is not null and char_length(v_category) > 80 then
      raise exception 'point category must be at most 80 characters';
    end if;

    insert into public.route_points(
      id, route_id, sort_order, location, title, species_name, highlight_title, category, note
    ) values (
      v_point_id, p_route_id, v_point_record.ordinal,
      public.st_setsrid(public.st_makepoint(v_lng, v_lat), 4326),
      left(coalesce(v_point ->> 'title', ''), 120),
      v_highlight,
      v_highlight,
      v_category,
      left(coalesce(v_point ->> 'text', ''), 4000)
    );

    for v_media_record in
      select value as item, ordinality::integer as ordinal
      from jsonb_array_elements(coalesce(v_point -> 'media', '[]'::jsonb)) with ordinality
    loop
      v_media := v_media_record.item;
      v_media_id := coalesce(nullif(v_media ->> 'id', '')::uuid, gen_random_uuid());
      v_path := v_media ->> 'storagePath';
      if p_enforce_owner_path then
        v_expected_prefix := format('routes/%s/%s/%s/', p_owner_id, p_route_id, v_point_id);
        if v_path is null or position(v_expected_prefix in v_path) <> 1 then
          raise exception 'media path does not belong to route owner';
        end if;
      elsif v_path is null or position('routes/' in v_path) <> 1 then
        raise exception 'invalid route media path';
      end if;
      insert into public.route_point_media(id, point_id, sort_order, storage_path, mime_type, width, height)
      values (
        v_media_id, v_point_id, v_media_record.ordinal, v_path,
        coalesce(v_media ->> 'mimeType', 'image/jpeg'),
        nullif(v_media ->> 'width', '')::integer,
        nullif(v_media ->> 'height', '')::integer
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.netrin_replace_route_points(uuid, jsonb, uuid, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Restore legacy submit_route_v3 / publish_route_v2 / admin_save_route
--    (does not clear retained M1 columns on every write; only dual-writes points)
-- ---------------------------------------------------------------------------

create or replace function public.submit_route_v3(
  p_route_id uuid,
  p_title jsonb,
  p_description jsonb,
  p_author text,
  p_points jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_route_id uuid;
  v_existing_status text;
  v_author text;
begin
  if not public.netrin_can_submit() then raise exception 'permanent active account required'; end if;
  if p_route_id is null then raise exception 'route id required'; end if;
  if jsonb_typeof(p_title) <> 'object' or jsonb_typeof(p_description) <> 'object' then
    raise exception 'route title and description must be objects';
  end if;
  if char_length(coalesce(p_title ->> 'zh-CN', '')) > 120
    or char_length(coalesce(p_title ->> 'en', '')) > 120
    or char_length(coalesce(p_description ->> 'zh-CN', '')) > 4000
    or char_length(coalesce(p_description ->> 'en', '')) > 4000 then
    raise exception 'route text exceeds allowed length';
  end if;
  select display_name into v_author from public.profiles where id = v_uid;
  select moderation_status into v_existing_status
  from public.routes where id = p_route_id and created_by = v_uid for update;
  if found and v_existing_status not in ('rejected', 'pending') then
    raise exception 'only rejected submissions can be edited and resubmitted';
  end if;
  if not found and exists(select 1 from public.routes where id = p_route_id) then
    raise exception 'route id belongs to another owner';
  end if;
  -- Retained M1 columns: force needs_geometry_review and clear any stale geometry
  -- so legacy point-only writes cannot leave falsely confirmed navigable routes.
  insert into public.routes(
    id, created_by, author, title, description, is_official, is_public,
    moderation_status, rejection_reason, reviewed_at, reviewed_by, updated_at, deleted_at,
    needs_geometry_review,
    line_geom, geometry_source, start_location, end_location,
    bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
  ) values (
    p_route_id, v_uid, left(coalesce(v_author, ''), 80), coalesce(p_title, '{}'::jsonb),
    coalesce(p_description, '{}'::jsonb), false, false, 'pending', null, null, null, now(), null,
    true,
    null, null, null, null,
    null, null, null, null
  )
  on conflict (id) do update set
    author = excluded.author,
    title = excluded.title,
    description = excluded.description,
    is_public = false,
    moderation_status = 'pending',
    rejection_reason = null,
    reviewed_at = null,
    reviewed_by = null,
    updated_at = now(),
    deleted_at = null,
    needs_geometry_review = true,
    line_geom = null,
    geometry_source = null,
    start_location = null,
    end_location = null,
    bbox_min_lng = null,
    bbox_min_lat = null,
    bbox_max_lng = null,
    bbox_max_lat = null
  where public.routes.created_by = v_uid
  returning id into v_route_id;
  if v_route_id is null then raise exception 'route submission unavailable'; end if;
  perform public.netrin_replace_route_points(v_route_id, p_points, v_uid, true);
  return v_route_id;
end;
$$;

revoke all on function public.submit_route_v3(uuid, jsonb, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_route_v3(uuid, jsonb, jsonb, text, jsonb)
  to authenticated;

create or replace function public.publish_route_v2(
  p_route_id uuid,
  p_title jsonb,
  p_description jsonb,
  p_author text,
  p_points jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.submit_route_v3(p_route_id, p_title, p_description, p_author, p_points);
$$;

revoke all on function public.publish_route_v2(uuid, jsonb, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_route_v2(uuid, jsonb, jsonb, text, jsonb)
  to authenticated;

create or replace function public.admin_save_route(
  p_route_id uuid,
  p_title jsonb,
  p_description jsonb,
  p_author text,
  p_points jsonb,
  p_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner uuid; v_before jsonb; v_after jsonb; v_status text;
begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  if jsonb_typeof(p_title) <> 'object' or jsonb_typeof(p_description) <> 'object'
    or char_length(coalesce(p_title ->> 'zh-CN', '')) > 120
    or char_length(coalesce(p_title ->> 'en', '')) > 120
    or char_length(coalesce(p_description ->> 'zh-CN', '')) > 4000
    or char_length(coalesce(p_description ->> 'en', '')) > 4000 then
    raise exception 'invalid route text';
  end if;
  select created_by, to_jsonb(r) into v_owner, v_before
  from public.routes r where id = p_route_id for update;
  if v_before is null then raise exception 'route not found'; end if;
  v_status := coalesce(p_status, v_before ->> 'moderation_status');
  if v_status not in ('pending', 'approved', 'rejected') then raise exception 'invalid status'; end if;
  if v_status = 'rejected' and nullif(v_before ->> 'rejection_reason', '') is null then
    raise exception 'use review_route with a rejection reason';
  end if;
  update public.routes set
    title = coalesce(p_title, '{}'::jsonb), description = coalesce(p_description, '{}'::jsonb),
    author = left(coalesce(p_author, ''), 80), moderation_status = v_status,
    is_public = (v_status = 'approved'),
    rejection_reason = case when v_status = 'rejected' then rejection_reason else null end,
    updated_at = now(), deleted_at = null
  where id = p_route_id;
  perform public.netrin_replace_route_points(p_route_id, p_points, v_owner, false);
  select to_jsonb(r) into v_after from public.routes r where id = p_route_id;
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, before_state, after_state)
  values (auth.uid(), 'route', p_route_id::text, 'admin-save', v_before, v_after);
  return p_route_id;
end;
$$;

revoke all on function public.admin_save_route(uuid, jsonb, jsonb, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.admin_save_route(uuid, jsonb, jsonb, text, jsonb, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Base tables remain denied to clients. M1 columns/indexes/data kept.
-- ---------------------------------------------------------------------------

revoke all on public.routes, public.route_points, public.route_point_media
  from anon, authenticated;

comment on function public.submit_route_v3(uuid, jsonb, jsonb, text, jsonb) is
  'Legacy submit after M1 behavioral rollback. Dual-writes highlight_title. M1 columns retained.';

commit;
notify pgrst, 'reload schema';
