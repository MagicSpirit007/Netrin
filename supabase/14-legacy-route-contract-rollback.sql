-- Behavioral rollback after restoring the database backup is preferred.
-- This script restores the compatibility surface without restoring deleted data
-- values. SQL17 must remain installed so the restored APIs use invoker views
-- over private RLS read models instead of reintroducing definer-view findings.
\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regnamespace('netrin_private') is null
    or to_regprocedure(
      'netrin_private.refresh_route_current_read_models(uuid)'
    ) is null then
    raise exception 'SQL17 read-model infrastructure is required before SQL14 rollback';
  end if;
end;
$$;

alter table public.route_points
  add column if not exists title text not null default '',
  add column if not exists species_name text not null default '';
update public.route_points
set
  title = coalesce(highlight_title, ''),
  species_name = coalesce(highlight_title, '');

comment on column public.route_points.highlight_title is
  'M1 highlight title. Dual-written with species_name during expand; contract phase drops species_name later.';
comment on function public.submit_route_v4(uuid, jsonb, jsonb, jsonb, jsonb) is
  'Idempotent route submit with travelMode/geometry/meta. Dual-writes highlight_title and species_name. Phone-confirmed active accounts only.';

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
$$;

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
          'storagePath', m.storage_path,
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
$$;

revoke all on function public.netrin_point_public_json(public.route_points)
  from public, anon, authenticated;
revoke all on function public.netrin_point_admin_json(public.route_points)
  from public, anon, authenticated;

do $$
begin
  if to_regprocedure(
    'public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.netrin_submit_route_v3_compat_impl(uuid,jsonb,jsonb,text,jsonb)'
    ) is null then
      raise exception 'legacy submit_route_v3 implementation is missing';
    end if;
    alter function public.netrin_submit_route_v3_compat_impl(
      uuid,
      jsonb,
      jsonb,
      text,
      jsonb
    ) rename to submit_route_v3;
  end if;
end;
$$;
grant execute on function public.submit_route_v3(
  uuid,
  jsonb,
  jsonb,
  text,
  jsonb
) to authenticated;

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
  select public.submit_route_v3(
    p_route_id,
    p_title,
    p_description,
    p_author,
    p_points
  )
$$;
grant execute on function public.publish_route_v2(
  uuid,
  jsonb,
  jsonb,
  text,
  jsonb
) to authenticated;

create table if not exists netrin_private.routes_public_v2_rm
as
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
      public.netrin_point_public_json(p)
      order by p.sort_order
    )
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
with no data;

create table if not exists netrin_private.routes_owned_v1_rm
as
select
  r.id,
  r.title,
  r.description,
  r.moderation_status,
  r.rejection_reason,
  r.created_at,
  r.updated_at,
  r.created_by as owner_id
from public.routes r
with no data;

alter table netrin_private.routes_public_v2_rm
  alter column id set not null;
alter table netrin_private.routes_owned_v1_rm
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'netrin_private.routes_public_v2_rm'::regclass
      and contype = 'p'
  ) then
    alter table netrin_private.routes_public_v2_rm
      add constraint routes_public_v2_rm_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'netrin_private.routes_owned_v1_rm'::regclass
      and contype = 'p'
  ) then
    alter table netrin_private.routes_owned_v1_rm
      add constraint routes_owned_v1_rm_pkey primary key (id);
  end if;
end;
$$;

create index if not exists routes_owned_v1_rm_owner_idx
  on netrin_private.routes_owned_v1_rm(owner_id);

alter table netrin_private.routes_public_v2_rm enable row level security;
alter table netrin_private.routes_owned_v1_rm enable row level security;

drop policy if exists routes_public_v2_rm_read
  on netrin_private.routes_public_v2_rm;
create policy routes_public_v2_rm_read
on netrin_private.routes_public_v2_rm
for select to anon, authenticated
using (true);

drop policy if exists routes_owned_v1_rm_read
  on netrin_private.routes_owned_v1_rm;
create policy routes_owned_v1_rm_read
on netrin_private.routes_owned_v1_rm
for select to authenticated
using (owner_id = (select auth.uid()));

revoke all on
  netrin_private.routes_public_v2_rm,
  netrin_private.routes_owned_v1_rm
from public, anon, authenticated, service_role;
grant select on netrin_private.routes_public_v2_rm to anon, authenticated;
grant select on netrin_private.routes_owned_v1_rm to authenticated;

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
        public.netrin_point_public_json(p)
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

revoke all on function netrin_private.refresh_route_legacy_read_models(uuid)
  from public, anon, authenticated, service_role;

truncate table
  netrin_private.routes_public_v2_rm,
  netrin_private.routes_owned_v1_rm;

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.routes loop
    perform netrin_private.refresh_route_current_read_models(v_id);
    perform netrin_private.refresh_route_legacy_read_models(v_id);
  end loop;
end;
$$;

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

revoke all on public.routes_owned_v1, public.routes_public_v2
  from public, anon, authenticated, service_role;
grant select on public.routes_owned_v1 to authenticated;
grant select on public.routes_public_v2 to anon, authenticated;

comment on view public.routes_owned_v1 is
  'Legacy owner route API restored as a SECURITY INVOKER shell over an RLS read model.';
comment on view public.routes_public_v2 is
  'Legacy public route API restored as a SECURITY INVOKER shell over an RLS read model.';

commit;

notify pgrst, 'reload schema';
