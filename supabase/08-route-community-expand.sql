-- 移步换景 / Netrin M1 route-community expand.
--
-- Expand-only: adds highlight_title dual-write, route mode/geometry/city/metrics,
-- discovery/detail/owned v2 projections, and submit_route_v4. Does NOT drop
-- species_name, routes_public_v2, routes_owned_v1, submit_route_v3, or v2 tables.
-- Does NOT create social interaction tables (follows/likes/comments/reports).
--
-- Manual command on the self-hosted server (after backup):
--   docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
--     < 08-route-community-expand.sql
--
-- The AI CLI must not run this migration over SSH.

begin;

-- ---------------------------------------------------------------------------
-- 1. route_points: highlight_title + category + backfill
-- ---------------------------------------------------------------------------

alter table public.route_points
  add column if not exists highlight_title text not null default '',
  add column if not exists category text;

update public.route_points
set highlight_title = left(
  coalesce(
    nullif(trim(species_name), ''),
    nullif(trim(title), ''),
    ''
  ),
  160
)
where coalesce(nullif(highlight_title, ''), '') = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.route_points'::regclass
      and conname = 'route_points_highlight_title_len'
  ) then
    alter table public.route_points
      add constraint route_points_highlight_title_len
      check (char_length(highlight_title) <= 160);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.route_points'::regclass
      and conname = 'route_points_category_len'
  ) then
    alter table public.route_points
      add constraint route_points_category_len
      check (category is null or char_length(category) between 1 and 80);
  end if;
end;
$$;

comment on column public.route_points.highlight_title is
  'M1 highlight title. Dual-written with species_name during expand; contract phase drops species_name later.';
comment on column public.route_points.category is
  'Optional highlight category (max 80). Nullable.';

-- ---------------------------------------------------------------------------
-- 2. routes: community route metadata + LineString + numeric bbox
-- ---------------------------------------------------------------------------

alter table public.routes
  add column if not exists travel_mode text,
  add column if not exists city_adcode text,
  add column if not exists city_name text,
  add column if not exists line_geom public.geometry(LineString, 4326),
  add column if not exists geometry_source text,
  add column if not exists start_location public.geometry(Point, 4326),
  add column if not exists end_location public.geometry(Point, 4326),
  add column if not exists bbox_min_lng double precision,
  add column if not exists bbox_min_lat double precision,
  add column if not exists bbox_max_lng double precision,
  add column if not exists bbox_max_lat double precision,
  add column if not exists distance_m integer,
  add column if not exists duration_s integer,
  add column if not exists metrics_updated_at timestamptz,
  add column if not exists difficulty text,
  add column if not exists is_loop boolean not null default false,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists cover_media_id uuid,
  add column if not exists needs_geometry_review boolean not null default true;

update public.routes
set travel_mode = 'walking'
where travel_mode is null;

alter table public.routes
  alter column travel_mode set default 'walking';

do $$
begin
  if exists (
    select 1 from public.routes where travel_mode is null
  ) then
    raise exception 'travel_mode backfill left null rows';
  end if;
end;
$$;

alter table public.routes
  alter column travel_mode set not null;

-- Immutable helper for CHECK (no subquery allowed in CHECK expressions).
create or replace function public.netrin_route_tags_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_tags is null
    or (
      cardinality(p_tags) <= 10
      and coalesce((
        select bool_and(
          tag is not null
          and btrim(tag) <> ''
          and char_length(tag) between 1 and 32
        )
        from unnest(p_tags) as t(tag)
      ), true)
    );
$$;

revoke all on function public.netrin_route_tags_valid(text[])
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_travel_mode_check'
  ) then
    alter table public.routes add constraint routes_travel_mode_check
      check (travel_mode in ('walking', 'cycling'));
  end if;

  alter table public.routes drop constraint if exists routes_geometry_source_check;
  alter table public.routes add constraint routes_geometry_source_check
    check (
      geometry_source is null
      or geometry_source in (
        'amap-planned',
        'field-recorded',
        'gpx-import',
        'geojson-import',
        'legacy-point-chain'
      )
    );

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_city_adcode_len'
  ) then
    alter table public.routes add constraint routes_city_adcode_len
      check (city_adcode is null or char_length(city_adcode) between 1 and 12);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_city_name_len'
  ) then
    alter table public.routes add constraint routes_city_name_len
      check (city_name is null or char_length(city_name) between 1 and 80);
  end if;

  alter table public.routes drop constraint if exists routes_difficulty_len;
  alter table public.routes drop constraint if exists routes_difficulty_check;
  alter table public.routes add constraint routes_difficulty_check
    check (difficulty is null or difficulty in ('easy', 'moderate', 'hard'));

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_distance_m_check'
  ) then
    alter table public.routes add constraint routes_distance_m_check
      check (distance_m is null or distance_m >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_duration_s_check'
  ) then
    alter table public.routes add constraint routes_duration_s_check
      check (duration_s is null or duration_s >= 0);
  end if;

  alter table public.routes drop constraint if exists routes_tags_len;
  alter table public.routes drop constraint if exists routes_tags_card;
  alter table public.routes add constraint routes_tags_card
    check (cardinality(tags) <= 10);
  alter table public.routes drop constraint if exists routes_tags_item_len;
  alter table public.routes add constraint routes_tags_item_len
    check (public.netrin_route_tags_valid(tags));

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_line_geom_srid'
  ) then
    alter table public.routes add constraint routes_line_geom_srid
      check (line_geom is null or public.st_srid(line_geom) = 4326);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_start_location_srid'
  ) then
    alter table public.routes add constraint routes_start_location_srid
      check (start_location is null or public.st_srid(start_location) = 4326);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_end_location_srid'
  ) then
    alter table public.routes add constraint routes_end_location_srid
      check (end_location is null or public.st_srid(end_location) = 4326);
  end if;

  alter table public.routes drop constraint if exists routes_bbox_srid;
  alter table public.routes drop constraint if exists routes_bbox_range;
  alter table public.routes add constraint routes_bbox_range
    check (
      (
        bbox_min_lng is null and bbox_min_lat is null
        and bbox_max_lng is null and bbox_max_lat is null
      )
      or (
        bbox_min_lng is not null and bbox_min_lat is not null
        and bbox_max_lng is not null and bbox_max_lat is not null
        and bbox_min_lng between -180 and 180
        and bbox_max_lng between -180 and 180
        and bbox_min_lat between -90 and 90
        and bbox_max_lat between -90 and 90
        and bbox_min_lng <= bbox_max_lng
        and bbox_min_lat <= bbox_max_lat
      )
    );
end;
$$;

-- Deterministic FK: clear cover before point replace cascade-deletes media.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_cover_media_id_fkey'
  ) then
    alter table public.routes
      add constraint routes_cover_media_id_fkey
      foreign key (cover_media_id)
      references public.route_point_media(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists routes_travel_mode_idx
  on public.routes(travel_mode)
  where deleted_at is null;

create index if not exists routes_city_adcode_idx
  on public.routes(city_adcode)
  where deleted_at is null and city_adcode is not null;

create index if not exists routes_discovery_created_idx
  on public.routes(created_at desc)
  where moderation_status = 'approved' and deleted_at is null;

create index if not exists routes_line_geom_gix
  on public.routes using gist(line_geom)
  where line_geom is not null and deleted_at is null;

create index if not exists routes_bbox_numeric_idx
  on public.routes(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat)
  where bbox_min_lng is not null and deleted_at is null;

create index if not exists routes_cover_media_idx
  on public.routes(cover_media_id)
  where cover_media_id is not null;

create index if not exists routes_needs_geometry_review_idx
  on public.routes(needs_geometry_review)
  where deleted_at is null;

comment on column public.routes.line_geom is
  'Author-confirmed WGS-84 LineString. Provider detours stay runtime-only.';
comment on column public.routes.geometry_source is
  'amap-planned | field-recorded | gpx-import | geojson-import | legacy-point-chain';
comment on column public.routes.needs_geometry_review is
  'True until submit_route_v4 commits author geometry. Existing/v3 rows stay true.';
comment on column public.routes.distance_m is
  'Refreshable metric snapshot in meters; not a geometry source of truth.';
comment on column public.routes.duration_s is
  'Refreshable metric snapshot in seconds; not a geometry source of truth.';

-- ---------------------------------------------------------------------------
-- 3. helpers: dual title + geometry parse (security definer, internal)
-- ---------------------------------------------------------------------------

create or replace function public.netrin_point_highlight_title(p_point jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    coalesce(
      nullif(trim(p_point ->> 'highlightTitle'), ''),
      nullif(trim(p_point ->> 'speciesName'), ''),
      nullif(trim(p_point ->> 'title'), ''),
      ''
    ),
    160
  );
$$;

revoke all on function public.netrin_point_highlight_title(jsonb) from public, anon, authenticated;

create or replace function public.netrin_parse_line_geom(p_geometry jsonb)
returns public.geometry
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text;
  v_coords jsonb;
  v_pair jsonb;
  v_lng double precision;
  v_lat double precision;
  v_points public.geometry[] := array[]::public.geometry[];
  v_i integer;
  v_n integer;
begin
  if p_geometry is null
    or jsonb_typeof(p_geometry) = 'null'
    or jsonb_typeof(p_geometry) <> 'object' then
    raise exception 'route geometry is required';
  end if;
  v_type := lower(coalesce(p_geometry ->> 'type', ''));
  if v_type <> 'linestring' then
    raise exception 'route geometry must be a GeoJSON LineString';
  end if;
  v_coords := p_geometry -> 'coordinates';
  if jsonb_typeof(v_coords) <> 'array' then
    raise exception 'route geometry coordinates must be an array';
  end if;
  v_n := jsonb_array_length(v_coords);
  if v_n < 2 or v_n > 10000 then
    raise exception 'route geometry needs between 2 and 10000 positions';
  end if;
  for v_i in 0 .. (v_n - 1) loop
    v_pair := v_coords -> v_i;
    if jsonb_typeof(v_pair) <> 'array' or jsonb_array_length(v_pair) < 2 then
      raise exception 'route geometry position must be [lng, lat]';
    end if;
    if jsonb_typeof(v_pair -> 0) <> 'number' or jsonb_typeof(v_pair -> 1) <> 'number' then
      raise exception 'route geometry coordinates must be numbers';
    end if;
    v_lng := (v_pair ->> 0)::double precision;
    v_lat := (v_pair ->> 1)::double precision;
    if v_lng not between -180 and 180 or v_lat not between -90 and 90 then
      raise exception 'route geometry coordinate out of range';
    end if;
    v_points := v_points || public.st_setsrid(public.st_makepoint(v_lng, v_lat), 4326);
  end loop;
  return public.st_setsrid(public.st_makeline(v_points), 4326);
end;
$$;

revoke all on function public.netrin_parse_line_geom(jsonb) from public, anon, authenticated;

-- Used by submit_route_v4 only. Requires non-null geometry and exact geometrySource.
create or replace function public.netrin_apply_route_meta(
  p_route_id uuid,
  p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_mode text;
  v_source text;
  v_line public.geometry;
  v_tags text[] := '{}'::text[];
  v_tag text;
  v_tag_raw text;
  v_tag_seen text[] := '{}'::text[];
  v_cover uuid;
  v_distance integer;
  v_duration integer;
  v_difficulty text;
  v_city_adcode text;
  v_city_name text;
  v_is_loop boolean := false;
  v_min_lng double precision;
  v_min_lat double precision;
  v_max_lng double precision;
  v_max_lat double precision;
  v_tag_count integer := 0;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    raise exception 'route meta must be a non-null object';
  end if;
  v_meta := p_meta;

  if not (v_meta ? 'geometry')
    or v_meta -> 'geometry' is null
    or jsonb_typeof(v_meta -> 'geometry') = 'null' then
    raise exception 'meta.geometry is required';
  end if;
  v_line := public.netrin_parse_line_geom(v_meta -> 'geometry');

  v_source := nullif(trim(coalesce(v_meta ->> 'geometrySource', '')), '');
  if v_source is null or v_source not in (
    'amap-planned',
    'field-recorded',
    'gpx-import',
    'geojson-import',
    'legacy-point-chain'
  ) then
    raise exception 'geometrySource must be an exact allowed value';
  end if;

  v_mode := lower(nullif(trim(coalesce(v_meta ->> 'travelMode', 'walking')), ''));
  if v_mode is null or v_mode not in ('walking', 'cycling') then
    raise exception 'travelMode must be walking or cycling';
  end if;

  if v_meta ? 'tags' then
    if jsonb_typeof(v_meta -> 'tags') <> 'array' then
      raise exception 'tags must be an array';
    end if;
    v_tag_count := jsonb_array_length(v_meta -> 'tags');
    if v_tag_count > 10 then
      raise exception 'tags may contain at most 10 items';
    end if;
    for v_tag_raw in
      select value from jsonb_array_elements_text(v_meta -> 'tags') as t(value)
    loop
      v_tag := trim(v_tag_raw);
      if v_tag is null or v_tag = '' then
        raise exception 'tags must not contain empty items';
      end if;
      if char_length(v_tag) > 32 then
        raise exception 'each tag length must be between 1 and 32 characters';
      end if;
      if v_tag = any (v_tag_seen) then
        raise exception 'tags must not contain duplicates';
      end if;
      v_tag_seen := array_append(v_tag_seen, v_tag);
      v_tags := array_append(v_tags, v_tag);
    end loop;
  end if;

  if v_meta ? 'coverMediaId'
    and v_meta -> 'coverMediaId' is not null
    and jsonb_typeof(v_meta -> 'coverMediaId') <> 'null'
    and nullif(trim(v_meta ->> 'coverMediaId'), '') is not null then
    begin
      v_cover := (v_meta ->> 'coverMediaId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'coverMediaId must be a uuid';
    end;
    if not exists (
      select 1
      from public.route_point_media m
      join public.route_points p on p.id = m.point_id
      where m.id = v_cover and p.route_id = p_route_id
    ) then
      raise exception 'coverMediaId must reference media on this route';
    end if;
  else
    v_cover := null;
  end if;

  if v_meta ? 'distanceM'
    and v_meta -> 'distanceM' is not null
    and jsonb_typeof(v_meta -> 'distanceM') <> 'null' then
    if jsonb_typeof(v_meta -> 'distanceM') <> 'number' then
      raise exception 'distanceM must be a number';
    end if;
    v_distance := round((v_meta ->> 'distanceM')::numeric)::integer;
    if v_distance < 0 then raise exception 'distanceM must be >= 0'; end if;
  end if;

  if v_meta ? 'durationS'
    and v_meta -> 'durationS' is not null
    and jsonb_typeof(v_meta -> 'durationS') <> 'null' then
    if jsonb_typeof(v_meta -> 'durationS') <> 'number' then
      raise exception 'durationS must be a number';
    end if;
    v_duration := round((v_meta ->> 'durationS')::numeric)::integer;
    if v_duration < 0 then raise exception 'durationS must be >= 0'; end if;
  end if;

  if v_meta ? 'difficulty'
    and v_meta -> 'difficulty' is not null
    and jsonb_typeof(v_meta -> 'difficulty') <> 'null'
    and nullif(trim(v_meta ->> 'difficulty'), '') is not null then
    v_difficulty := trim(v_meta ->> 'difficulty');
    if v_difficulty not in ('easy', 'moderate', 'hard') then
      raise exception 'difficulty must be easy, moderate, or hard';
    end if;
  else
    v_difficulty := null;
  end if;

  if v_meta ? 'cityAdcode' then
    v_city_adcode := left(nullif(trim(v_meta ->> 'cityAdcode'), ''), 12);
  end if;
  if v_meta ? 'cityName' then
    v_city_name := left(nullif(trim(v_meta ->> 'cityName'), ''), 80);
  end if;
  if v_meta ? 'isLoop' then
    if jsonb_typeof(v_meta -> 'isLoop') <> 'boolean' then
      raise exception 'isLoop must be a boolean';
    end if;
    v_is_loop := (v_meta ->> 'isLoop')::boolean;
  end if;

  v_min_lng := public.st_xmin(v_line);
  v_min_lat := public.st_ymin(v_line);
  v_max_lng := public.st_xmax(v_line);
  v_max_lat := public.st_ymax(v_line);

  update public.routes set
    travel_mode = v_mode,
    city_adcode = case when v_meta ? 'cityAdcode' then v_city_adcode else city_adcode end,
    city_name = case when v_meta ? 'cityName' then v_city_name else city_name end,
    line_geom = v_line,
    geometry_source = v_source,
    start_location = public.st_startpoint(v_line),
    end_location = public.st_endpoint(v_line),
    bbox_min_lng = v_min_lng,
    bbox_min_lat = v_min_lat,
    bbox_max_lng = v_max_lng,
    bbox_max_lat = v_max_lat,
    distance_m = case when v_meta ? 'distanceM' then v_distance else distance_m end,
    duration_s = case when v_meta ? 'durationS' then v_duration else duration_s end,
    metrics_updated_at = case
      when v_meta ? 'distanceM' or v_meta ? 'durationS' then now()
      else metrics_updated_at
    end,
    difficulty = case when v_meta ? 'difficulty' then v_difficulty else difficulty end,
    is_loop = case when v_meta ? 'isLoop' then v_is_loop else is_loop end,
    tags = case when v_meta ? 'tags' then v_tags else tags end,
    cover_media_id = case when v_meta ? 'coverMediaId' then v_cover else cover_media_id end,
    needs_geometry_review = false,
    updated_at = now()
  where id = p_route_id;
end;
$$;

revoke all on function public.netrin_apply_route_meta(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. dual-write point replace (keeps species_name + highlight_title in sync)
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

  -- Clear cover FK before cascade-deleting media rows.
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
-- 5. dual-read projections (v2 kept; new discovery/detail/owned)
-- ---------------------------------------------------------------------------

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
    'highlightTitle', nullif(coalesce(
      nullif(p.highlight_title, ''),
      nullif(p.species_name, ''),
      nullif(p.title, '')
    ), ''),
    'speciesName', nullif(coalesce(nullif(p.species_name, ''), p.highlight_title), ''),
    'category', p.category,
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
    'highlightTitle', nullif(coalesce(
      nullif(p.highlight_title, ''),
      nullif(p.species_name, ''),
      nullif(p.title, '')
    ), ''),
    'speciesName', nullif(coalesce(nullif(p.species_name, ''), p.highlight_title), ''),
    'category', p.category,
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

drop function if exists public.netrin_route_bbox_json(public.geometry);

create or replace function public.netrin_route_bbox_json(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_min_lng is null or p_min_lat is null
      or p_max_lng is null or p_max_lat is null then null
    else jsonb_build_object(
      'minLng', p_min_lng,
      'minLat', p_min_lat,
      'maxLng', p_max_lng,
      'maxLat', p_max_lat
    )
  end;
$$;

revoke all on function public.netrin_route_bbox_json(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

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
  r.id,
  r.created_by,
  r.author,
  r.title,
  r.description,
  r.moderation_status,
  r.rejection_reason,
  r.created_at,
  r.updated_at,
  r.reviewed_at,
  r.reviewed_by,
  r.travel_mode,
  r.city_adcode,
  r.city_name,
  r.geometry_source,
  r.distance_m,
  r.duration_s,
  r.metrics_updated_at,
  r.difficulty,
  r.is_loop,
  r.tags,
  r.cover_media_id,
  r.needs_geometry_review,
  case
    when r.line_geom is null then null
    else public.st_asgeojson(r.line_geom)::jsonb
  end as geometry,
  public.netrin_route_bbox_json(
    r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat
  ) as bbox,
  coalesce((
    select jsonb_agg(public.netrin_point_admin_json(p) order by p.sort_order)
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where public.netrin_is_admin();

revoke all on public.routes_admin_v1 from anon, authenticated;
grant select on public.routes_admin_v1 to authenticated;

-- Legacy owned projection unchanged in column set (compat).
drop view if exists public.routes_owned_v1;
create view public.routes_owned_v1
with (security_invoker = off) as
select id, title, description, moderation_status, rejection_reason, created_at, updated_at
from public.routes
where created_by = auth.uid();

revoke all on public.routes_owned_v1 from anon, authenticated;
grant select on public.routes_owned_v1 to authenticated;

drop view if exists public.routes_owned_v2;
create view public.routes_owned_v2
with (security_invoker = off) as
select
  r.id,
  r.title,
  r.description,
  r.moderation_status,
  r.rejection_reason,
  r.created_at,
  r.updated_at,
  r.travel_mode,
  r.city_adcode,
  r.city_name,
  r.geometry_source,
  r.distance_m,
  r.duration_s,
  r.metrics_updated_at,
  r.difficulty,
  r.is_loop,
  r.tags,
  r.cover_media_id,
  r.needs_geometry_review,
  case
    when r.line_geom is null then null
    else public.st_asgeojson(r.line_geom)::jsonb
  end as geometry,
  public.netrin_route_bbox_json(
    r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat
  ) as bbox,
  coalesce((
    select jsonb_agg(public.netrin_point_admin_json(p) order by p.sort_order)
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.created_by = auth.uid();

revoke all on public.routes_owned_v2 from anon, authenticated;
grant select on public.routes_owned_v2 to authenticated;

-- Discovery is a function, never a view.
drop view if exists public.routes_discovery_v1;
drop function if exists public.routes_discovery_v1(
  timestamptz, uuid, integer, text, text, integer, integer, integer, integer, text, text[],
  double precision, double precision, double precision, double precision
);

create or replace function public.routes_discovery_v1(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20,
  p_city_adcode text default null,
  p_travel_mode text default null,
  p_min_distance_m integer default null,
  p_max_distance_m integer default null,
  p_min_duration_s integer default null,
  p_max_duration_s integer default null,
  p_difficulty text default null,
  p_tags text[] default null,
  p_min_lng double precision default null,
  p_min_lat double precision default null,
  p_max_lng double precision default null,
  p_max_lat double precision default null
)
returns table (
  id uuid,
  author text,
  title jsonb,
  description jsonb,
  downloads integer,
  likes integer,
  created_at timestamptz,
  updated_at timestamptz,
  travel_mode text,
  city_adcode text,
  city_name text,
  distance_m integer,
  duration_s integer,
  metrics_updated_at timestamptz,
  difficulty text,
  is_loop boolean,
  tags text[],
  cover_media_id uuid,
  bbox jsonb,
  point_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_mode text;
  v_difficulty text;
  v_bound_count integer;
begin
  v_limit := coalesce(p_limit, 20);
  if v_limit < 1 or v_limit > 50 then
    raise exception 'limit must be between 1 and 50';
  end if;

  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'cursor_created_at and cursor_id must be supplied together';
  end if;

  if p_travel_mode is not null then
    v_mode := lower(trim(p_travel_mode));
    if v_mode not in ('walking', 'cycling') then
      raise exception 'travel_mode must be walking or cycling';
    end if;
  end if;

  if p_difficulty is not null then
    v_difficulty := lower(trim(p_difficulty));
    if v_difficulty not in ('easy', 'moderate', 'hard') then
      raise exception 'difficulty must be easy, moderate, or hard';
    end if;
  end if;

  if p_min_distance_m is not null and p_max_distance_m is not null
    and p_min_distance_m > p_max_distance_m then
    raise exception 'min_distance_m must be <= max_distance_m';
  end if;
  if p_min_duration_s is not null and p_max_duration_s is not null
    and p_min_duration_s > p_max_duration_s then
    raise exception 'min_duration_s must be <= max_duration_s';
  end if;

  v_bound_count :=
    (p_min_lng is not null)::integer +
    (p_min_lat is not null)::integer +
    (p_max_lng is not null)::integer +
    (p_max_lat is not null)::integer;
  if v_bound_count not in (0, 4) then
    raise exception 'bbox bounds must all be null or all provided';
  end if;
  if v_bound_count = 4 then
    if p_min_lng > p_max_lng or p_min_lat > p_max_lat then
      raise exception 'invalid bbox bounds';
    end if;
    if p_min_lng < -180 or p_max_lng > 180 or p_min_lat < -90 or p_max_lat > 90 then
      raise exception 'bbox bounds out of range';
    end if;
  end if;

  if p_tags is not null then
    if cardinality(p_tags) > 10 then
      raise exception 'tags filter may contain at most 10 items';
    end if;
    if exists (
      select 1 from unnest(p_tags) as t(tag)
      where tag is null or char_length(tag) < 1 or char_length(tag) > 32
    ) then
      raise exception 'each tags filter item length must be between 1 and 32 characters';
    end if;
  end if;

  return query
  select
    r.id,
    r.author,
    r.title,
    r.description,
    r.downloads,
    r.likes,
    r.created_at,
    r.updated_at,
    r.travel_mode,
    r.city_adcode,
    r.city_name,
    r.distance_m,
    r.duration_s,
    r.metrics_updated_at,
    r.difficulty,
    r.is_loop,
    r.tags,
    r.cover_media_id,
    public.netrin_route_bbox_json(
      r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat
    ) as bbox,
    (
      select count(*)::integer
      from public.route_points p
      where p.route_id = r.id
    ) as point_count
  from public.routes r
  where r.moderation_status = 'approved'
    and r.deleted_at is null
    and r.line_geom is not null
    and r.needs_geometry_review = false
    and (p_city_adcode is null or r.city_adcode = p_city_adcode)
    and (v_mode is null or r.travel_mode = v_mode)
    and (p_min_distance_m is null or r.distance_m >= p_min_distance_m)
    and (p_max_distance_m is null or r.distance_m <= p_max_distance_m)
    and (p_min_duration_s is null or r.duration_s >= p_min_duration_s)
    and (p_max_duration_s is null or r.duration_s <= p_max_duration_s)
    and (v_difficulty is null or r.difficulty = v_difficulty)
    and (p_tags is null or r.tags @> p_tags)
    and (
      v_bound_count = 0
      or (
        r.bbox_min_lng is not null
        and r.bbox_max_lng >= p_min_lng
        and r.bbox_min_lng <= p_max_lng
        and r.bbox_max_lat >= p_min_lat
        and r.bbox_min_lat <= p_max_lat
      )
    )
    and (
      p_cursor_created_at is null
      or (r.created_at, r.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by r.created_at desc, r.id desc
  limit v_limit;
end;
$$;

revoke all on function public.routes_discovery_v1(
  timestamptz, uuid, integer, text, text, integer, integer, integer, integer, text, text[],
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.routes_discovery_v1(
  timestamptz, uuid, integer, text, text, integer, integer, integer, integer, text, text[],
  double precision, double precision, double precision, double precision
) to anon, authenticated;

create or replace function public.get_route_detail_v1(p_route_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.routes%rowtype;
  v_result jsonb;
begin
  if p_route_id is null then
    raise exception 'route id required';
  end if;

  select * into v_row
  from public.routes r
  where r.id = p_route_id
    and r.moderation_status = 'approved'
    and r.deleted_at is null
    and r.line_geom is not null
    and r.needs_geometry_review = false;

  if not found then
    return null;
  end if;

  v_result := jsonb_build_object(
    'id', v_row.id,
    'author', v_row.author,
    'title', v_row.title,
    'description', v_row.description,
    'downloads', v_row.downloads,
    'likes', v_row.likes,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'travelMode', v_row.travel_mode,
    'cityAdcode', v_row.city_adcode,
    'cityName', v_row.city_name,
    'geometrySource', v_row.geometry_source,
    'distanceM', v_row.distance_m,
    'durationS', v_row.duration_s,
    'metricsUpdatedAt', v_row.metrics_updated_at,
    'difficulty', v_row.difficulty,
    'isLoop', v_row.is_loop,
    'tags', to_jsonb(v_row.tags),
    'coverMediaId', v_row.cover_media_id,
    'geometry', public.st_asgeojson(v_row.line_geom)::jsonb,
    'bbox', public.netrin_route_bbox_json(
      v_row.bbox_min_lng, v_row.bbox_min_lat, v_row.bbox_max_lng, v_row.bbox_max_lat
    ),
    'highlights', coalesce((
      select jsonb_agg(public.netrin_point_public_json(p) order by p.sort_order)
      from public.route_points p
      where p.route_id = v_row.id
    ), '[]'::jsonb)
  );

  return v_result;
end;
$$;

revoke all on function public.get_route_detail_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_route_detail_v1(uuid) to anon, authenticated;

comment on function public.get_route_detail_v1(uuid) is
  'Navigable approved route detail only: line_geom present, needs_geometry_review=false. Dual-read highlights, media ids only.';

-- ---------------------------------------------------------------------------
-- 6. submit_route_v4 + keep submit_route_v3 (now dual-writes via replace)
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
  insert into public.routes(
    id, created_by, author, title, description, is_official, is_public,
    moderation_status, rejection_reason, reviewed_at, reviewed_by, updated_at, deleted_at,
    travel_mode, needs_geometry_review,
    line_geom, geometry_source, start_location, end_location,
    bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
  ) values (
    p_route_id, v_uid, left(coalesce(v_author, ''), 80), coalesce(p_title, '{}'::jsonb),
    coalesce(p_description, '{}'::jsonb), false, false, 'pending', null, null, null, now(), null,
    'walking', true,
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

create or replace function public.submit_route_v4(
  p_route_id uuid,
  p_title jsonb,
  p_description jsonb,
  p_points jsonb,
  p_meta jsonb
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
  v_meta jsonb;
  v_initial_mode text := 'walking';
begin
  if not public.netrin_can_submit() then raise exception 'permanent active account required'; end if;
  if p_route_id is null then raise exception 'route id required'; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    raise exception 'route meta must be a non-null object';
  end if;
  v_meta := p_meta;
  if jsonb_typeof(p_title) <> 'object' or jsonb_typeof(p_description) <> 'object' then
    raise exception 'route title and description must be objects';
  end if;
  if char_length(coalesce(p_title ->> 'zh-CN', '')) > 120
    or char_length(coalesce(p_title ->> 'en', '')) > 120
    or char_length(coalesce(p_description ->> 'zh-CN', '')) > 4000
    or char_length(coalesce(p_description ->> 'en', '')) > 4000 then
    raise exception 'route text exceeds allowed length';
  end if;

  if v_meta ? 'travelMode' then
    v_initial_mode := lower(nullif(trim(v_meta ->> 'travelMode'), ''));
    if v_initial_mode is null or v_initial_mode not in ('walking', 'cycling') then
      raise exception 'travelMode must be walking or cycling';
    end if;
  end if;

  select display_name into v_author from public.profiles where id = v_uid;
  select moderation_status into v_existing_status
  from public.routes where id = p_route_id and created_by = v_uid for update;
  if found and v_existing_status not in ('rejected', 'pending') then
    raise exception 'only rejected or pending submissions can be edited and resubmitted';
  end if;
  if not found and exists(select 1 from public.routes where id = p_route_id) then
    raise exception 'route id belongs to another owner';
  end if;

  insert into public.routes(
    id, created_by, author, title, description, is_official, is_public,
    moderation_status, rejection_reason, reviewed_at, reviewed_by, updated_at, deleted_at,
    travel_mode, needs_geometry_review
  ) values (
    p_route_id, v_uid, left(coalesce(v_author, ''), 80), coalesce(p_title, '{}'::jsonb),
    coalesce(p_description, '{}'::jsonb), false, false, 'pending', null, null, null, now(), null,
    v_initial_mode, true
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
    deleted_at = null
  where public.routes.created_by = v_uid
  returning id into v_route_id;

  if v_route_id is null then raise exception 'route submission unavailable'; end if;

  -- Points/media first; apply_meta validates cover against the new set and sets needs_geometry_review=false.
  perform public.netrin_replace_route_points(v_route_id, p_points, v_uid, true);
  perform public.netrin_apply_route_meta(v_route_id, v_meta);
  return v_route_id;
end;
$$;

revoke all on function public.submit_route_v4(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_route_v4(uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

comment on function public.submit_route_v4(uuid, jsonb, jsonb, jsonb, jsonb) is
  'Idempotent route submit with travelMode/geometry/meta. Dual-writes highlight_title and species_name. Phone-confirmed active accounts only.';

-- Keep stale PWA alias → v3.
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

-- Admin save continues to dual-write via replace; optional meta stays out of v1 admin RPC.
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

-- Base tables stay non-selectable for clients; projections only.
revoke all on public.routes, public.route_points, public.route_point_media from anon, authenticated;

commit;
notify pgrst, 'reload schema';
