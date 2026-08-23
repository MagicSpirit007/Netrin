-- 移步换景 / Netrin route storage v2 — expand phase.
--
-- Adds ordered WGS-84 points and point media while keeping the v1 route view/RPC
-- temporarily available for a safe frontend rollout. This migration does not delete
-- routes or Storage objects. Run manually on the self-hosted Supabase server:
--   docker exec -i supabase-db psql -U postgres -d postgres < 04-route-points-v2-expand.sql
--
-- The AI CLI must not run this migration over SSH.

begin;

-- V2 rows intentionally have no route LineString. The legacy column stays present
-- during the expand phase but is nullable until the contract migration drops it.
alter table public.routes alter column geom drop not null;

create table if not exists public.route_points (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  sort_order integer not null check (sort_order > 0),
  location public.geometry(Point, 4326) not null,
  title text not null default '',
  species_name text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (route_id, sort_order),
  check (public.st_x(location) between -180 and 180),
  check (public.st_y(location) between -90 and 90)
);

create index if not exists route_points_route_order_idx
  on public.route_points(route_id, sort_order);
create index if not exists route_points_location_gix
  on public.route_points using gist(location);

create table if not exists public.route_point_media (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references public.route_points(id) on delete cascade,
  sort_order integer not null check (sort_order between 1 and 8),
  storage_path text not null unique,
  mime_type text not null default 'image/jpeg'
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  unique (point_id, sort_order)
);

create index if not exists route_point_media_point_order_idx
  on public.route_point_media(point_id, sort_order);

alter table public.route_points enable row level security;
alter table public.route_point_media enable row level security;

drop policy if exists route_points_public_read on public.route_points;
drop policy if exists route_points_owner_insert on public.route_points;
drop policy if exists route_points_owner_update on public.route_points;
drop policy if exists route_points_owner_delete on public.route_points;

create policy route_points_public_read
on public.route_points for select to anon, authenticated
using (exists (
  select 1 from public.routes r
  where r.id = route_points.route_id
    and (r.is_public = true or r.created_by = (select auth.uid()))
));

create policy route_points_owner_insert
on public.route_points for insert to authenticated
with check (exists (
  select 1 from public.routes r
  where r.id = route_points.route_id and r.created_by = (select auth.uid())
));

create policy route_points_owner_update
on public.route_points for update to authenticated
using (exists (
  select 1 from public.routes r
  where r.id = route_points.route_id and r.created_by = (select auth.uid())
))
with check (exists (
  select 1 from public.routes r
  where r.id = route_points.route_id and r.created_by = (select auth.uid())
));

create policy route_points_owner_delete
on public.route_points for delete to authenticated
using (exists (
  select 1 from public.routes r
  where r.id = route_points.route_id and r.created_by = (select auth.uid())
));

drop policy if exists route_point_media_public_read on public.route_point_media;
drop policy if exists route_point_media_owner_insert on public.route_point_media;
drop policy if exists route_point_media_owner_update on public.route_point_media;
drop policy if exists route_point_media_owner_delete on public.route_point_media;

create policy route_point_media_public_read
on public.route_point_media for select to anon, authenticated
using (exists (
  select 1
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where p.id = route_point_media.point_id
    and (r.is_public = true or r.created_by = (select auth.uid()))
));

create policy route_point_media_owner_insert
on public.route_point_media for insert to authenticated
with check (exists (
  select 1
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where p.id = route_point_media.point_id and r.created_by = (select auth.uid())
));

create policy route_point_media_owner_update
on public.route_point_media for update to authenticated
using (exists (
  select 1
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where p.id = route_point_media.point_id and r.created_by = (select auth.uid())
))
with check (exists (
  select 1
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where p.id = route_point_media.point_id and r.created_by = (select auth.uid())
));

create policy route_point_media_owner_delete
on public.route_point_media for delete to authenticated
using (exists (
  select 1
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where p.id = route_point_media.point_id and r.created_by = (select auth.uid())
));

-- Backfill valid legacy stop objects. Re-running the migration is safe.
with legacy_points as (
  select
    r.id as route_id,
    stop.item,
    stop.ordinality::integer as sort_order
  from public.routes r
  cross join lateral jsonb_array_elements(coalesce(r.stops, '[]'::jsonb))
    with ordinality as stop(item, ordinality)
  where jsonb_typeof(stop.item -> 'lng') = 'number'
    and jsonb_typeof(stop.item -> 'lat') = 'number'
    and (stop.item ->> 'lng')::double precision between -180 and 180
    and (stop.item ->> 'lat')::double precision between -90 and 90
)
insert into public.route_points (
  route_id, sort_order, location, title, species_name, note
)
select
  route_id,
  sort_order,
  public.st_setsrid(public.st_makepoint(
    (item ->> 'lng')::double precision,
    (item ->> 'lat')::double precision
  ), 4326),
  coalesce(item ->> 'speciesName', ''),
  coalesce(item ->> 'speciesName', ''),
  coalesce(item ->> 'text', '')
from legacy_points
on conflict (route_id, sort_order) do nothing;

with legacy_media as (
  select
    r.id as route_id,
    stop.ordinality::integer as sort_order,
    nullif(stop.item ->> 'photo', '') as storage_path
  from public.routes r
  cross join lateral jsonb_array_elements(coalesce(r.stops, '[]'::jsonb))
    with ordinality as stop(item, ordinality)
)
insert into public.route_point_media (point_id, sort_order, storage_path, mime_type)
select p.id, 1, legacy_media.storage_path, 'image/jpeg'
from legacy_media
join public.route_points p
  on p.route_id = legacy_media.route_id and p.sort_order = legacy_media.sort_order
where legacy_media.storage_path is not null
on conflict (storage_path) do nothing;

drop view if exists public.routes_public_v2;
create view public.routes_public_v2
with (security_invoker = on) as
select
  r.id,
  r.author,
  r.title,
  r.description,
  r.downloads,
  r.likes,
  r.created_at,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'order', p.sort_order,
        'lng', public.st_x(p.location),
        'lat', public.st_y(p.location),
        'title', p.title,
        'text', p.note,
        'speciesName', nullif(p.species_name, ''),
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
      ) order by p.sort_order
    )
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.is_public = true;

grant select on public.routes, public.route_points, public.route_point_media to anon, authenticated;
grant select on public.routes_public_v2 to anon, authenticated;
grant insert, update, delete on public.route_points, public.route_point_media to authenticated;

create or replace function public.publish_route_v2(
  p_route_id uuid,
  p_title jsonb,
  p_description jsonb,
  p_author text,
  p_points jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_route_id uuid;
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
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_route_id is null then raise exception 'route id required'; end if;
  if p_points is null or jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) < 2 then
    raise exception 'route needs at least 2 points';
  end if;

  -- Only write columns that survive the contract migration. During expand, the
  -- legacy columns use their existing defaults; after 05 this same function
  -- keeps working without referring to columns that no longer exist.
  insert into public.routes (
    id, created_by, author, title, description, is_official, is_public
  ) values (
    p_route_id, v_uid, coalesce(p_author, ''), coalesce(p_title, '{}'::jsonb),
    coalesce(p_description, '{}'::jsonb), false, true
  )
  on conflict (id) do update set
    author = excluded.author,
    title = excluded.title,
    description = excluded.description,
    is_public = true
  where public.routes.created_by = v_uid
  returning id into v_route_id;

  if v_route_id is null then raise exception 'route id belongs to another owner'; end if;
  delete from public.route_points where route_id = v_route_id;

  for v_point_record in
    select value as item, ordinality::integer as ordinal
    from jsonb_array_elements(p_points) with ordinality
  loop
    v_point := v_point_record.item;
    v_point_id := (v_point ->> 'id')::uuid;
    if jsonb_typeof(v_point -> 'lng') <> 'number' or jsonb_typeof(v_point -> 'lat') <> 'number' then
      raise exception 'point coordinates must be numbers';
    end if;
    v_lng := (v_point ->> 'lng')::double precision;
    v_lat := (v_point ->> 'lat')::double precision;
    if v_lng not between -180 and 180 or v_lat not between -90 and 90 then
      raise exception 'point coordinate out of range';
    end if;
    if jsonb_array_length(coalesce(v_point -> 'media', '[]'::jsonb)) > 8 then
      raise exception 'a point may contain at most 8 images';
    end if;

    insert into public.route_points (
      id, route_id, sort_order, location, title, species_name, note
    ) values (
      v_point_id,
      v_route_id,
      v_point_record.ordinal,
      public.st_setsrid(public.st_makepoint(v_lng, v_lat), 4326),
      coalesce(v_point ->> 'title', ''),
      coalesce(v_point ->> 'speciesName', ''),
      coalesce(v_point ->> 'text', '')
    );

    for v_media_record in
      select value as item, ordinality::integer as ordinal
      from jsonb_array_elements(coalesce(v_point -> 'media', '[]'::jsonb)) with ordinality
    loop
      v_media := v_media_record.item;
      v_media_id := (v_media ->> 'id')::uuid;
      v_path := v_media ->> 'storagePath';
      v_expected_prefix := format('routes/%s/%s/%s/', v_uid, v_route_id, v_point_id);
      if v_path is null or position(v_expected_prefix in v_path) <> 1 then
        raise exception 'media path does not belong to route owner';
      end if;
      insert into public.route_point_media (
        id, point_id, sort_order, storage_path, mime_type, width, height
      ) values (
        v_media_id,
        v_point_id,
        v_media_record.ordinal,
        v_path,
        coalesce(v_media ->> 'mimeType', 'image/jpeg'),
        nullif(v_media ->> 'width', '')::integer,
        nullif(v_media ->> 'height', '')::integer
      );
    end loop;
  end loop;

  return v_route_id;
end;
$$;

revoke all on function public.publish_route_v2(uuid, jsonb, jsonb, text, jsonb) from public;
grant execute on function public.publish_route_v2(uuid, jsonb, jsonb, text, jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';
