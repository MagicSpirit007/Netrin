-- Netrin R1 / M4: explicit administrator geometry review for legacy routes.
-- Local migration only. The AI does not run this on the production server.
begin;

create or replace function public.get_my_account_v1()
returns jsonb language sql stable security definer set search_path=''
as $$ select case when auth.uid() is null then null else jsonb_build_object(
  'displayName',p.display_name,'status',p.account_status,'isAdmin',public.netrin_is_admin(auth.uid())
) end from public.profiles p where p.id=auth.uid() $$;
revoke all on function public.get_my_account_v1() from public,anon,authenticated;
grant execute on function public.get_my_account_v1() to authenticated;

create or replace function public.admin_confirm_route_geometry_v1(
  p_route_id uuid,
  p_navigable boolean,
  p_travel_mode text default null,
  p_geometry_source text default null,
  p_geometry jsonb default null,
  p_meta jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_geom public.geometry;
  v_mode text;
  v_source text;
  v_reason text;
  v_tags text[];
  v_cover uuid;
begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  if p_route_id is null or p_navigable is null then raise exception 'route id and conclusion required'; end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'review reason required (1..1000 chars)';
  end if;

  select to_jsonb(r) into v_before
  from public.routes r where r.id = p_route_id for update;
  if v_before is null then raise exception 'route not found'; end if;

  if p_navigable then
    v_mode := lower(trim(coalesce(p_travel_mode, '')));
    v_source := lower(trim(coalesce(p_geometry_source, '')));
    if v_mode not in ('walking', 'cycling') then raise exception 'travel mode must be walking or cycling'; end if;
    if v_source not in ('amap-planned', 'field-recorded', 'gpx-import', 'geojson-import', 'legacy-point-chain') then
      raise exception 'invalid geometry source';
    end if;
    if p_geometry is null or p_geometry ->> 'type' <> 'LineString' then
      raise exception 'WGS-84 LineString geometry required';
    end if;
    begin
      v_geom := public.st_setsrid(public.st_geomfromgeojson(p_geometry::text), 4326);
    exception when others then
      raise exception 'invalid GeoJSON geometry';
    end;
    if public.geometrytype(v_geom) <> 'LINESTRING' or not public.st_isvalid(v_geom)
      or public.st_npoints(v_geom) < 2 or public.st_npoints(v_geom) > 10000 then
      raise exception 'geometry must be a valid LineString with 2..10000 points';
    end if;
    if public.st_xmin(public.box2d(v_geom)) < -180 or public.st_xmax(public.box2d(v_geom)) > 180
      or public.st_ymin(public.box2d(v_geom)) < -90 or public.st_ymax(public.box2d(v_geom)) > 90 then
      raise exception 'geometry coordinates outside WGS-84 bounds';
    end if;

    if p_meta ? 'tags' then
      if jsonb_typeof(p_meta -> 'tags') <> 'array' then raise exception 'tags must be an array'; end if;
      select coalesce(array_agg(value), '{}'::text[]) into v_tags
      from jsonb_array_elements_text(p_meta -> 'tags');
      if not public.netrin_route_tags_valid(v_tags) then raise exception 'invalid tags'; end if;
    end if;
    if nullif(p_meta ->> 'coverMediaId', '') is not null then
      begin v_cover := (p_meta ->> 'coverMediaId')::uuid;
      exception when others then raise exception 'invalid cover media id'; end;
      if not exists (
        select 1 from public.route_point_media m
        join public.route_points rp on rp.id = m.point_id
        where m.id = v_cover and rp.route_id = p_route_id
      ) then raise exception 'cover media must belong to this route'; end if;
    end if;

    update public.routes set
      travel_mode = v_mode,
      geometry_source = v_source,
      line_geom = v_geom,
      needs_geometry_review = false,
      city_adcode = nullif(trim(p_meta ->> 'cityAdcode'), ''),
      city_name = nullif(left(trim(p_meta ->> 'cityName'), 80), ''),
      distance_m = case when p_meta ? 'distanceM' then greatest(0, (p_meta ->> 'distanceM')::integer) else distance_m end,
      duration_s = case when p_meta ? 'durationS' then greatest(0, (p_meta ->> 'durationS')::integer) else duration_s end,
      metrics_updated_at = now(),
      difficulty = case when p_meta ? 'difficulty' then nullif(lower(trim(p_meta ->> 'difficulty')), '') else difficulty end,
      is_loop = case when p_meta ? 'isLoop' then (p_meta ->> 'isLoop')::boolean else is_loop end,
      tags = case when p_meta ? 'tags' then v_tags else tags end,
      cover_media_id = case when p_meta ? 'coverMediaId' then v_cover else cover_media_id end,
      bbox_min_lng = public.st_xmin(public.box2d(v_geom)),
      bbox_min_lat = public.st_ymin(public.box2d(v_geom)),
      bbox_max_lng = public.st_xmax(public.box2d(v_geom)),
      bbox_max_lat = public.st_ymax(public.box2d(v_geom)),
      updated_at = now()
    where id = p_route_id;
  else
    update public.routes set needs_geometry_review = true, updated_at = now()
    where id = p_route_id;
  end if;

  select to_jsonb(r) into v_after from public.routes r where r.id = p_route_id;
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, note, before_state, after_state)
  values (
    auth.uid(), 'route', p_route_id::text,
    case when p_navigable then 'geometry-confirmed-navigable' else 'geometry-confirmed-not-navigable' end,
    v_reason, v_before, v_after
  );

  return jsonb_build_object(
    'routeId', p_route_id,
    'navigable', p_navigable,
    'needsGeometryReview', not p_navigable,
    'reviewedAt', now()
  );
end;
$$;

revoke all on function public.admin_confirm_route_geometry_v1(uuid, boolean, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.admin_confirm_route_geometry_v1(uuid, boolean, text, text, jsonb, jsonb, text)
  to authenticated;

comment on function public.admin_confirm_route_geometry_v1(uuid, boolean, text, text, jsonb, jsonb, text) is
  'Manual M4 gate for legacy routes. Never auto-promotes; every conclusion requires an admin, reason, and moderation audit event.';

commit;
notify pgrst, 'reload schema';
