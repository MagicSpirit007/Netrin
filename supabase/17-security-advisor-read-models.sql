-- Netrin Security Advisor hardening: RLS-backed private read models.
--
-- Replaces six SECURITY DEFINER views with public SECURITY INVOKER shells over
-- non-exposed, RLS-protected read models. Public relation names and columns stay
-- stable; browser roles still receive no privileges on the business base tables.
--
-- Manual command on the self-hosted server (after 16 + verified backup):
--   docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
--     < 17-security-advisor-read-models.sql
--
-- The AI CLI must not run this migration over SSH.
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'routes_public_v2',
    'routes_owned_v1',
    'routes_owned_v2',
    'routes_admin_v1',
    'appearance_catalog_public',
    'appearance_submissions_private_v1'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_name
        and c.relkind = 'v'
    ) then
      raise exception 'required public view % is missing', v_name;
    end if;
  end loop;
end;
$$;

-- This migration is intentionally one-shot. Refuse to adopt or overwrite an
-- existing private schema whose contents may have a different owner/purpose.
create schema netrin_private authorization postgres;
revoke all on schema netrin_private from public, anon, authenticated, service_role;
alter default privileges in schema netrin_private
  revoke execute on functions from public;
alter default privileges in schema netrin_private
  revoke all on tables from public;

-- Clone the currently deployed API column types without copying filtered rows.
create table if not exists netrin_private.routes_public_v2_rm
as
select
  id,
  author,
  title,
  description,
  downloads,
  likes,
  created_at,
  points
from public.routes_public_v2
with no data;

create table if not exists netrin_private.routes_owned_v1_rm
as
select
  id,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at
from public.routes_owned_v1
with no data;
alter table netrin_private.routes_owned_v1_rm
  add column if not exists owner_id uuid;

create table if not exists netrin_private.routes_owned_v2_rm
as
select
  id,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at,
  travel_mode,
  city_adcode,
  city_name,
  geometry_source,
  distance_m,
  duration_s,
  metrics_updated_at,
  difficulty,
  is_loop,
  tags,
  cover_media_id,
  needs_geometry_review,
  geometry,
  bbox,
  points
from public.routes_owned_v2
with no data;
alter table netrin_private.routes_owned_v2_rm
  add column if not exists owner_id uuid;

create table if not exists netrin_private.routes_admin_v1_rm
as
select
  id,
  created_by,
  author,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at,
  reviewed_at,
  reviewed_by,
  travel_mode,
  city_adcode,
  city_name,
  geometry_source,
  distance_m,
  duration_s,
  metrics_updated_at,
  difficulty,
  is_loop,
  tags,
  cover_media_id,
  needs_geometry_review,
  geometry,
  bbox,
  points
from public.routes_admin_v1
with no data;

create table if not exists netrin_private.appearance_catalog_public_rm
as
select
  id,
  package_id,
  package_version,
  display_name,
  summary,
  declared_author,
  license,
  package_sha256,
  byte_size,
  reviewed_at,
  updated_at
from public.appearance_catalog_public
with no data;

create table if not exists netrin_private.appearance_submissions_private_v1_rm
as
select
  id,
  owner_id,
  package_id,
  package_version,
  display_name,
  summary,
  declared_author,
  license,
  package_sha256,
  byte_size,
  storage_path,
  audit_report,
  moderation_status,
  rejection_reason,
  reviewed_at,
  reviewed_by,
  created_at,
  updated_at
from public.appearance_submissions_private_v1
with no data;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'routes_public_v2_rm',
    'routes_owned_v1_rm',
    'routes_owned_v2_rm',
    'routes_admin_v1_rm',
    'appearance_catalog_public_rm',
    'appearance_submissions_private_v1_rm'
  ]
  loop
    execute format(
      'alter table netrin_private.%I alter column id set not null',
      v_table
    );
    if not exists (
      select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      where n.nspname = 'netrin_private'
        and r.relname = v_table
        and c.contype = 'p'
    ) then
      execute format(
        'alter table netrin_private.%I add constraint %I primary key (id)',
        v_table,
        v_table || '_pkey'
      );
    end if;
  end loop;
end;
$$;

create index if not exists routes_owned_v1_rm_owner_idx
  on netrin_private.routes_owned_v1_rm(owner_id);
create index if not exists routes_owned_v2_rm_owner_idx
  on netrin_private.routes_owned_v2_rm(owner_id);
create index if not exists appearance_private_v1_rm_owner_idx
  on netrin_private.appearance_submissions_private_v1_rm(owner_id);

create table if not exists netrin_private.projection_refresh_queue (
  transaction_id bigint not null,
  entity_type text not null check (entity_type in ('route', 'appearance')),
  entity_id uuid not null,
  primary key (transaction_id, entity_type, entity_id)
);
alter table netrin_private.projection_refresh_queue enable row level security;
revoke all on netrin_private.projection_refresh_queue
  from public, anon, authenticated, service_role;

alter table netrin_private.routes_public_v2_rm enable row level security;
alter table netrin_private.routes_owned_v1_rm enable row level security;
alter table netrin_private.routes_owned_v2_rm enable row level security;
alter table netrin_private.routes_admin_v1_rm enable row level security;
alter table netrin_private.appearance_catalog_public_rm enable row level security;
alter table netrin_private.appearance_submissions_private_v1_rm enable row level security;

drop policy if exists routes_public_v2_rm_read on netrin_private.routes_public_v2_rm;
create policy routes_public_v2_rm_read
on netrin_private.routes_public_v2_rm
for select to anon, authenticated
using (true);

drop policy if exists routes_owned_v1_rm_read on netrin_private.routes_owned_v1_rm;
create policy routes_owned_v1_rm_read
on netrin_private.routes_owned_v1_rm
for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists routes_owned_v2_rm_read on netrin_private.routes_owned_v2_rm;
create policy routes_owned_v2_rm_read
on netrin_private.routes_owned_v2_rm
for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists routes_admin_v1_rm_read on netrin_private.routes_admin_v1_rm;
create policy routes_admin_v1_rm_read
on netrin_private.routes_admin_v1_rm
for select to authenticated
using ((select public.netrin_is_admin()));

drop policy if exists appearance_catalog_public_rm_read
  on netrin_private.appearance_catalog_public_rm;
create policy appearance_catalog_public_rm_read
on netrin_private.appearance_catalog_public_rm
for select to anon, authenticated
using (true);

drop policy if exists appearance_private_v1_rm_read
  on netrin_private.appearance_submissions_private_v1_rm;
create policy appearance_private_v1_rm_read
on netrin_private.appearance_submissions_private_v1_rm
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (select public.netrin_is_admin())
);

revoke all on
  netrin_private.routes_public_v2_rm,
  netrin_private.routes_owned_v1_rm,
  netrin_private.routes_owned_v2_rm,
  netrin_private.routes_admin_v1_rm,
  netrin_private.appearance_catalog_public_rm,
  netrin_private.appearance_submissions_private_v1_rm
from public, anon, authenticated, service_role;

grant select on
  netrin_private.routes_public_v2_rm,
  netrin_private.appearance_catalog_public_rm
to anon, authenticated;

grant select on
  netrin_private.routes_owned_v1_rm,
  netrin_private.routes_owned_v2_rm,
  netrin_private.routes_admin_v1_rm,
  netrin_private.appearance_submissions_private_v1_rm
to authenticated;

-- Current route read models survive SQL14.
create or replace function netrin_private.refresh_route_current_read_models(
  p_route_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from netrin_private.routes_admin_v1_rm where id = p_route_id;
  delete from netrin_private.routes_owned_v2_rm where id = p_route_id;

  insert into netrin_private.routes_admin_v1_rm (
    id,
    created_by,
    author,
    title,
    description,
    moderation_status,
    rejection_reason,
    created_at,
    updated_at,
    reviewed_at,
    reviewed_by,
    travel_mode,
    city_adcode,
    city_name,
    geometry_source,
    distance_m,
    duration_s,
    metrics_updated_at,
    difficulty,
    is_loop,
    tags,
    cover_media_id,
    needs_geometry_review,
    geometry,
    bbox,
    points
  )
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
    end,
    public.netrin_route_bbox_json(
      r.bbox_min_lng,
      r.bbox_min_lat,
      r.bbox_max_lng,
      r.bbox_max_lat
    ),
    coalesce((
      select jsonb_agg(
        public.netrin_point_admin_json(p)
        order by p.sort_order
      )
      from public.route_points p
      where p.route_id = r.id
    ), '[]'::jsonb)
  from public.routes r
  where r.id = p_route_id;

  insert into netrin_private.routes_owned_v2_rm (
    id,
    title,
    description,
    moderation_status,
    rejection_reason,
    created_at,
    updated_at,
    travel_mode,
    city_adcode,
    city_name,
    geometry_source,
    distance_m,
    duration_s,
    metrics_updated_at,
    difficulty,
    is_loop,
    tags,
    cover_media_id,
    needs_geometry_review,
    geometry,
    bbox,
    points,
    owner_id
  )
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
    end,
    public.netrin_route_bbox_json(
      r.bbox_min_lng,
      r.bbox_min_lat,
      r.bbox_max_lng,
      r.bbox_max_lat
    ),
    coalesce((
      select jsonb_agg(
        public.netrin_point_admin_json(p)
        order by p.sort_order
      )
      from public.route_points p
      where p.route_id = r.id
    ), '[]'::jsonb),
    r.created_by
  from public.routes r
  where r.id = p_route_id;
end;
$$;

-- Legacy read models remain until SQL14 passes its observation gates.
create or replace function netrin_private.refresh_route_legacy_read_models(
  p_route_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from netrin_private.routes_public_v2_rm where id = p_route_id;
  delete from netrin_private.routes_owned_v1_rm where id = p_route_id;

  insert into netrin_private.routes_public_v2_rm (
    id,
    author,
    title,
    description,
    downloads,
    likes,
    created_at,
    points
  )
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
          'highlightTitle', nullif(coalesce(
            nullif(p.highlight_title, ''),
            nullif(p.species_name, ''),
            nullif(p.title, '')
          ), ''),
          'speciesName', nullif(coalesce(
            nullif(p.species_name, ''),
            p.highlight_title
          ), ''),
          'category', p.category,
          'media', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', m.id,
                'order', m.sort_order,
                'mimeType', m.mime_type,
                'width', m.width,
                'height', m.height
              )
              order by m.sort_order
            )
            from public.route_point_media m
            where m.point_id = p.id
          ), '[]'::jsonb)
        )
        order by p.sort_order
      )
      from public.route_points p
      where p.route_id = r.id
    ), '[]'::jsonb)
  from public.routes r
  where r.id = p_route_id
    and r.moderation_status = 'approved'
    and r.deleted_at is null;

  insert into netrin_private.routes_owned_v1_rm (
    id,
    title,
    description,
    moderation_status,
    rejection_reason,
    created_at,
    updated_at,
    owner_id
  )
  select
    r.id,
    r.title,
    r.description,
    r.moderation_status,
    r.rejection_reason,
    r.created_at,
    r.updated_at,
    r.created_by
  from public.routes r
  where r.id = p_route_id;
end;
$$;

create or replace function netrin_private.refresh_appearance_read_models(
  p_submission_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from netrin_private.appearance_catalog_public_rm
  where id = p_submission_id;
  delete from netrin_private.appearance_submissions_private_v1_rm
  where id = p_submission_id;

  insert into netrin_private.appearance_catalog_public_rm (
    id,
    package_id,
    package_version,
    display_name,
    summary,
    declared_author,
    license,
    package_sha256,
    byte_size,
    reviewed_at,
    updated_at
  )
  select
    a.id,
    a.package_id,
    a.package_version,
    a.display_name,
    a.summary,
    a.declared_author,
    a.license,
    a.package_sha256,
    a.byte_size,
    a.reviewed_at,
    a.updated_at
  from public.appearance_submissions a
  where a.id = p_submission_id
    and a.moderation_status = 'approved';

  insert into netrin_private.appearance_submissions_private_v1_rm (
    id,
    owner_id,
    package_id,
    package_version,
    display_name,
    summary,
    declared_author,
    license,
    package_sha256,
    byte_size,
    storage_path,
    audit_report,
    moderation_status,
    rejection_reason,
    reviewed_at,
    reviewed_by,
    created_at,
    updated_at
  )
  select
    a.id,
    a.owner_id,
    a.package_id,
    a.package_version,
    a.display_name,
    a.summary,
    a.declared_author,
    a.license,
    a.package_sha256,
    a.byte_size,
    a.storage_path,
    a.audit_report,
    a.moderation_status,
    a.rejection_reason,
    a.reviewed_at,
    a.reviewed_by,
    a.created_at,
    a.updated_at
  from public.appearance_submissions a
  where a.id = p_submission_id;
end;
$$;

create or replace function netrin_private.enqueue_projection_refresh(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_entity_id is null
    or p_entity_type not in ('route', 'appearance') then
    return;
  end if;

  insert into netrin_private.projection_refresh_queue (
    transaction_id,
    entity_type,
    entity_id
  )
  values (
    pg_catalog.txid_current(),
    p_entity_type,
    p_entity_id
  )
  on conflict do nothing;
end;
$$;

create or replace function netrin_private.queue_route_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform netrin_private.enqueue_projection_refresh('route', old.id);
    return old;
  end if;

  perform netrin_private.enqueue_projection_refresh('route', new.id);
  return new;
end;
$$;

create or replace function netrin_private.queue_route_point_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform netrin_private.enqueue_projection_refresh('route', old.route_id);
  end if;
  if tg_op <> 'DELETE' then
    perform netrin_private.enqueue_projection_refresh('route', new.route_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function netrin_private.queue_route_media_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route_id uuid;
begin
  if tg_op <> 'INSERT' then
    select p.route_id into v_route_id
    from public.route_points p
    where p.id = old.point_id;
    perform netrin_private.enqueue_projection_refresh('route', v_route_id);
  end if;

  if tg_op <> 'DELETE' then
    select p.route_id into v_route_id
    from public.route_points p
    where p.id = new.point_id;
    perform netrin_private.enqueue_projection_refresh('route', v_route_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function netrin_private.queue_appearance_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform netrin_private.enqueue_projection_refresh('appearance', old.id);
    return old;
  end if;

  perform netrin_private.enqueue_projection_refresh('appearance', new.id);
  return new;
end;
$$;

create or replace function netrin_private.process_projection_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_type = 'route' then
    perform netrin_private.refresh_route_current_read_models(new.entity_id);
    if pg_catalog.to_regprocedure(
      'netrin_private.refresh_route_legacy_read_models(uuid)'
    ) is not null then
      execute
        'select netrin_private.refresh_route_legacy_read_models($1)'
        using new.entity_id;
    end if;
  elsif new.entity_type = 'appearance' then
    perform netrin_private.refresh_appearance_read_models(new.entity_id);
  end if;

  delete from netrin_private.projection_refresh_queue q
  where q.transaction_id = new.transaction_id
    and q.entity_type = new.entity_type
    and q.entity_id = new.entity_id;

  return null;
end;
$$;

revoke all on function netrin_private.refresh_route_current_read_models(uuid)
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.refresh_route_legacy_read_models(uuid)
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.refresh_appearance_read_models(uuid)
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.enqueue_projection_refresh(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.queue_route_refresh_trigger()
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.queue_route_point_refresh_trigger()
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.queue_route_media_refresh_trigger()
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.queue_appearance_refresh_trigger()
  from public, anon, authenticated, service_role;
revoke all on function netrin_private.process_projection_refresh_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists netrin_projection_routes_queue on public.routes;
create trigger netrin_projection_routes_queue
after insert or update or delete on public.routes
for each row execute function netrin_private.queue_route_refresh_trigger();

drop trigger if exists netrin_projection_route_points_queue on public.route_points;
create trigger netrin_projection_route_points_queue
after insert or update or delete on public.route_points
for each row execute function netrin_private.queue_route_point_refresh_trigger();

drop trigger if exists netrin_projection_route_media_queue
  on public.route_point_media;
create trigger netrin_projection_route_media_queue
after insert or update or delete on public.route_point_media
for each row execute function netrin_private.queue_route_media_refresh_trigger();

drop trigger if exists netrin_projection_appearance_queue
  on public.appearance_submissions;
create trigger netrin_projection_appearance_queue
after insert or update or delete on public.appearance_submissions
for each row execute function netrin_private.queue_appearance_refresh_trigger();

drop trigger if exists netrin_projection_refresh_deferred
  on netrin_private.projection_refresh_queue;
create constraint trigger netrin_projection_refresh_deferred
after insert on netrin_private.projection_refresh_queue
deferrable initially deferred
for each row
execute function netrin_private.process_projection_refresh_trigger();

-- Stop concurrent writers while the initial read models are rebuilt and the
-- public relation shells are swapped atomically.
lock table
  public.routes,
  public.route_points,
  public.route_point_media,
  public.appearance_submissions
in share row exclusive mode;

truncate table
  netrin_private.projection_refresh_queue,
  netrin_private.routes_public_v2_rm,
  netrin_private.routes_owned_v1_rm,
  netrin_private.routes_owned_v2_rm,
  netrin_private.routes_admin_v1_rm,
  netrin_private.appearance_catalog_public_rm,
  netrin_private.appearance_submissions_private_v1_rm;

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.routes loop
    perform netrin_private.refresh_route_current_read_models(v_id);
    perform netrin_private.refresh_route_legacy_read_models(v_id);
  end loop;

  for v_id in select id from public.appearance_submissions loop
    perform netrin_private.refresh_appearance_read_models(v_id);
  end loop;
end;
$$;

do $$
declare
  v_expected bigint;
  v_actual bigint;
begin
  select count(*) into v_expected from public.routes;
  select count(*) into v_actual from netrin_private.routes_admin_v1_rm;
  if v_actual <> v_expected then
    raise exception 'admin route read model count %, expected %', v_actual, v_expected;
  end if;
  select count(*) into v_actual from netrin_private.routes_owned_v1_rm;
  if v_actual <> v_expected then
    raise exception 'owned v1 read model count %, expected %', v_actual, v_expected;
  end if;
  select count(*) into v_actual from netrin_private.routes_owned_v2_rm;
  if v_actual <> v_expected then
    raise exception 'owned v2 read model count %, expected %', v_actual, v_expected;
  end if;

  select count(*) into v_expected
  from public.routes
  where moderation_status = 'approved' and deleted_at is null;
  select count(*) into v_actual from netrin_private.routes_public_v2_rm;
  if v_actual <> v_expected then
    raise exception 'public route read model count %, expected %', v_actual, v_expected;
  end if;

  select count(*) into v_expected from public.appearance_submissions;
  select count(*) into v_actual
  from netrin_private.appearance_submissions_private_v1_rm;
  if v_actual <> v_expected then
    raise exception 'private appearance read model count %, expected %',
      v_actual, v_expected;
  end if;

  select count(*) into v_expected
  from public.appearance_submissions
  where moderation_status = 'approved';
  select count(*) into v_actual
  from netrin_private.appearance_catalog_public_rm;
  if v_actual <> v_expected then
    raise exception 'appearance catalog read model count %, expected %',
      v_actual, v_expected;
  end if;

  if exists (
    select 1
    from netrin_private.routes_public_v2_rm r
    cross join lateral jsonb_array_elements(r.points) p
    where p ?| array[
      'storagePath',
      'storage_path',
      'createdBy',
      'created_by',
      'moderationStatus',
      'rejectionReason'
    ]
      or exists (
        select 1
        from jsonb_array_elements(coalesce(p -> 'media', '[]'::jsonb)) m
        where m ?| array['storagePath', 'storage_path', 'url']
      )
  ) then
    raise exception 'public route read model leaks protected fields';
  end if;
end;
$$;

-- Compare every projected row with the still-live definer views before the
-- atomic swap. JWT identities are simulated only inside this transaction.
do $$
declare
  v_owner uuid;
  v_admin uuid;
begin
  if exists (
    (
      select to_jsonb(v) from public.routes_public_v2 v
      except
      select to_jsonb(m) from netrin_private.routes_public_v2_rm m
    )
    union all
    (
      select to_jsonb(m) from netrin_private.routes_public_v2_rm m
      except
      select to_jsonb(v) from public.routes_public_v2 v
    )
  ) then
    raise exception 'public route read model differs from routes_public_v2';
  end if;

  if exists (
    (
      select to_jsonb(v) from public.appearance_catalog_public v
      except
      select to_jsonb(m)
      from netrin_private.appearance_catalog_public_rm m
    )
    union all
    (
      select to_jsonb(m)
      from netrin_private.appearance_catalog_public_rm m
      except
      select to_jsonb(v) from public.appearance_catalog_public v
    )
  ) then
    raise exception 'appearance catalog read model differs from public view';
  end if;

  for v_owner in
    select distinct created_by
    from public.routes
    where created_by is not null
  loop
    perform set_config('request.jwt.claim.sub', v_owner::text, true);

    if exists (
      (
        select to_jsonb(v) from public.routes_owned_v1 v
        except
        select to_jsonb(m) - 'owner_id'
        from netrin_private.routes_owned_v1_rm m
        where m.owner_id = v_owner
      )
      union all
      (
        select to_jsonb(m) - 'owner_id'
        from netrin_private.routes_owned_v1_rm m
        where m.owner_id = v_owner
        except
        select to_jsonb(v) from public.routes_owned_v1 v
      )
    ) then
      raise exception 'owned v1 read model differs for owner %', v_owner;
    end if;

    if exists (
      (
        select to_jsonb(v) from public.routes_owned_v2 v
        except
        select to_jsonb(m) - 'owner_id'
        from netrin_private.routes_owned_v2_rm m
        where m.owner_id = v_owner
      )
      union all
      (
        select to_jsonb(m) - 'owner_id'
        from netrin_private.routes_owned_v2_rm m
        where m.owner_id = v_owner
        except
        select to_jsonb(v) from public.routes_owned_v2 v
      )
    ) then
      raise exception 'owned v2 read model differs for owner %', v_owner;
    end if;
  end loop;

  for v_owner in
    select distinct owner_id
    from public.appearance_submissions
    where owner_id is not null
      and not public.netrin_is_admin(owner_id)
  loop
    perform set_config('request.jwt.claim.sub', v_owner::text, true);

    if exists (
      (
        select to_jsonb(v)
        from public.appearance_submissions_private_v1 v
        except
        select to_jsonb(m)
        from netrin_private.appearance_submissions_private_v1_rm m
        where m.owner_id = v_owner
      )
      union all
      (
        select to_jsonb(m)
        from netrin_private.appearance_submissions_private_v1_rm m
        where m.owner_id = v_owner
        except
        select to_jsonb(v)
        from public.appearance_submissions_private_v1 v
      )
    ) then
      raise exception 'appearance private read model differs for owner %',
        v_owner;
    end if;
  end loop;

  select ur.user_id
  into v_admin
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.role = 'admin'
    and p.account_status = 'active'
  order by ur.user_id
  limit 1;

  if v_admin is null then
    raise exception 'an active administrator is required for projection comparison';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  if exists (
    (
      select to_jsonb(v) from public.routes_admin_v1 v
      except
      select to_jsonb(m) from netrin_private.routes_admin_v1_rm m
    )
    union all
    (
      select to_jsonb(m) from netrin_private.routes_admin_v1_rm m
      except
      select to_jsonb(v) from public.routes_admin_v1 v
    )
  ) then
    raise exception 'admin route read model differs from public view';
  end if;

  if exists (
    (
      select to_jsonb(v)
      from public.appearance_submissions_private_v1 v
      except
      select to_jsonb(m)
      from netrin_private.appearance_submissions_private_v1_rm m
    )
    union all
    (
      select to_jsonb(m)
      from netrin_private.appearance_submissions_private_v1_rm m
      except
      select to_jsonb(v)
      from public.appearance_submissions_private_v1 v
    )
  ) then
    raise exception 'admin appearance read model differs from public view';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

drop view if exists public.routes_public_v2;
create view public.routes_public_v2
with (security_invoker = true, security_barrier = true) as
select
  id,
  author,
  title,
  description,
  downloads,
  likes,
  created_at,
  points
from netrin_private.routes_public_v2_rm;

drop view if exists public.routes_owned_v1;
create view public.routes_owned_v1
with (security_invoker = true, security_barrier = true) as
select
  id,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at
from netrin_private.routes_owned_v1_rm;

drop view if exists public.routes_owned_v2;
create view public.routes_owned_v2
with (security_invoker = true, security_barrier = true) as
select
  id,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at,
  travel_mode,
  city_adcode,
  city_name,
  geometry_source,
  distance_m,
  duration_s,
  metrics_updated_at,
  difficulty,
  is_loop,
  tags,
  cover_media_id,
  needs_geometry_review,
  geometry,
  bbox,
  points
from netrin_private.routes_owned_v2_rm;

drop view if exists public.routes_admin_v1;
create view public.routes_admin_v1
with (security_invoker = true, security_barrier = true) as
select
  id,
  created_by,
  author,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at,
  reviewed_at,
  reviewed_by,
  travel_mode,
  city_adcode,
  city_name,
  geometry_source,
  distance_m,
  duration_s,
  metrics_updated_at,
  difficulty,
  is_loop,
  tags,
  cover_media_id,
  needs_geometry_review,
  geometry,
  bbox,
  points
from netrin_private.routes_admin_v1_rm;

drop view if exists public.appearance_catalog_public;
create view public.appearance_catalog_public
with (security_invoker = true, security_barrier = true) as
select
  id,
  package_id,
  package_version,
  display_name,
  summary,
  declared_author,
  license,
  package_sha256,
  byte_size,
  reviewed_at,
  updated_at
from netrin_private.appearance_catalog_public_rm;

drop view if exists public.appearance_submissions_private_v1;
create view public.appearance_submissions_private_v1
with (security_invoker = true, security_barrier = true) as
select
  id,
  owner_id,
  package_id,
  package_version,
  display_name,
  summary,
  declared_author,
  license,
  package_sha256,
  byte_size,
  storage_path,
  audit_report,
  moderation_status,
  rejection_reason,
  reviewed_at,
  reviewed_by,
  created_at,
  updated_at
from netrin_private.appearance_submissions_private_v1_rm;

revoke all on
  public.routes_public_v2,
  public.routes_owned_v1,
  public.routes_owned_v2,
  public.routes_admin_v1,
  public.appearance_catalog_public,
  public.appearance_submissions_private_v1
from public, anon, authenticated, service_role;

grant select on public.routes_public_v2 to anon, authenticated;
grant select on public.appearance_catalog_public to anon, authenticated;
grant select on public.routes_owned_v1 to authenticated;
grant select on public.routes_owned_v2 to authenticated;
grant select on public.routes_admin_v1 to authenticated;
grant select on public.appearance_submissions_private_v1 to authenticated;

comment on view public.routes_public_v2 is
  'Legacy public route API. SECURITY INVOKER shell over an RLS read model; base route tables remain unavailable to browser roles.';
comment on view public.routes_owned_v1 is
  'Legacy owner route API. SECURITY INVOKER shell over an owner-filtered RLS read model.';
comment on view public.routes_owned_v2 is
  'Current owner route API. SECURITY INVOKER shell over an owner-filtered RLS read model.';
comment on view public.routes_admin_v1 is
  'Administrator route API. SECURITY INVOKER shell over an administrator-only RLS read model.';
comment on view public.appearance_catalog_public is
  'Approved appearance catalog. SECURITY INVOKER shell over a public RLS read model.';
comment on view public.appearance_submissions_private_v1 is
  'Owner/admin appearance API with an explicit fixed column list and RLS-backed SECURITY INVOKER access.';

comment on schema netrin_private is
  'Non-exposed Netrin read models and trigger helpers. Never add this schema to PostgREST db-schemas.';

commit;

notify pgrst, 'reload schema';
