-- 移步换景 / Netrin accounts, moderation and appearance workshop.
--
-- This migration is intentionally idempotent. It makes route media private,
-- preserves the routes_public_v2 API name with a narrower projection, and
-- separates public, owner and administrator reads.
-- Run manually on the self-hosted Supabase server after taking DB/Storage and
-- frontend backups:
--   docker exec -i supabase-db psql -U postgres -d postgres < 06-accounts-moderation-and-appearances.sql
--
-- The AI CLI must not run this migration over SSH.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(display_name) between 1 and 60)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role)
);

create or replace function public.handle_netrin_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), '用户-' || left(new.id::text, 8)), 60)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_netrin_auth_user_created on auth.users;
create trigger on_netrin_auth_user_created
after insert on auth.users
for each row execute function public.handle_netrin_user_created();

revoke all on function public.handle_netrin_user_created() from public, anon, authenticated;

insert into public.profiles (id, display_name, created_at, updated_at)
select
  u.id,
  left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), '用户-' || left(u.id::text, 8)), 60),
  coalesce(u.created_at, now()),
  now()
from auth.users u
on conflict (id) do nothing;

create or replace function public.netrin_is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_user_id
      and ur.role = 'admin'
      and p.account_status = 'active'
  );
$$;

create or replace function public.netrin_can_submit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.account_status = 'active'
    );
$$;

revoke all on function public.netrin_is_admin(uuid) from public, anon, authenticated;
grant execute on function public.netrin_is_admin(uuid) to authenticated;
revoke all on function public.netrin_can_submit() from public, anon, authenticated;
grant execute on function public.netrin_can_submit() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
drop policy if exists profiles_update_self_or_admin on public.profiles;
drop policy if exists user_roles_read_self_or_admin on public.user_roles;

create policy profiles_read_self_or_admin
on public.profiles for select to authenticated
using (id = auth.uid() or public.netrin_is_admin());

create policy profiles_update_self_or_admin
on public.profiles for update to authenticated
using ((id = auth.uid() and account_status = 'active') or public.netrin_is_admin())
with check (
  public.netrin_is_admin()
  or (id = auth.uid() and account_status = 'active')
);

create policy user_roles_read_self_or_admin
on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.netrin_is_admin());

revoke all on public.profiles, public.user_roles from anon, authenticated;
grant select on public.profiles, public.user_roles to authenticated;
grant update(display_name) on public.profiles to authenticated;

-- Recreate route-media writes so anonymous and suspended identities cannot
-- upload orphan objects even when they still hold an unexpired JWT.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('route-media', 'route-media', false, 5242880, array['image/jpeg'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists route_media_public_read on storage.objects;
drop policy if exists route_media_auth_insert on storage.objects;
drop policy if exists route_media_auth_update on storage.objects;
drop policy if exists route_media_auth_delete on storage.objects;

create or replace function public.netrin_route_media_is_unclaimed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists(
    select 1 from public.route_point_media where storage_path = p_path
  );
$$;
revoke all on function public.netrin_route_media_is_unclaimed(text) from public, anon, authenticated;
grant execute on function public.netrin_route_media_is_unclaimed(text) to authenticated;

create policy route_media_auth_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'route-media'
  and public.netrin_can_submit()
  and (storage.foldername(name))[1] = 'routes'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy route_media_auth_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'route-media'
  and public.netrin_can_submit()
  and (storage.foldername(name))[1] = 'routes'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.netrin_route_media_is_unclaimed(name)
);

alter table public.routes
  add column if not exists moderation_status text,
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

update public.routes
set moderation_status = case when is_public then 'approved' else 'pending' end
where moderation_status is null;

alter table public.routes alter column moderation_status set default 'pending';
alter table public.routes alter column moderation_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_moderation_status_check'
  ) then
    alter table public.routes add constraint routes_moderation_status_check
      check (moderation_status in ('pending', 'approved', 'rejected', 'deleted'));
  end if;
end;
$$;

-- Approved content survives hard account deletion with anonymous attribution.
alter table public.routes alter column created_by drop not null;
do $$
declare v_constraint text;
begin
  select c.conname into v_constraint
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.routes'::regclass
    and c.contype = 'f'
    and a.attname = 'created_by'
  limit 1;
  if v_constraint is not null then
    execute format('alter table public.routes drop constraint %I', v_constraint);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routes'::regclass and conname = 'routes_created_by_fkey'
  ) then
    alter table public.routes add constraint routes_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;
end;
$$;

create index if not exists routes_moderation_queue_idx
  on public.routes(moderation_status, created_at desc)
  where deleted_at is null;
create index if not exists routes_owner_moderation_idx
  on public.routes(created_by, moderation_status, updated_at desc);

create table if not exists public.moderation_events (
  id bigint generated by default as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  subject_type text not null check (subject_type in ('route', 'appearance', 'account', 'role')),
  subject_id text not null,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists moderation_events_created_idx
  on public.moderation_events(created_at desc);
create index if not exists moderation_events_subject_idx
  on public.moderation_events(subject_type, subject_id, created_at desc);
alter table public.moderation_events enable row level security;
drop policy if exists moderation_events_admin_read on public.moderation_events;
create policy moderation_events_admin_read
on public.moderation_events for select to authenticated
using (public.netrin_is_admin());
revoke all on public.moderation_events from anon, authenticated;
grant select on public.moderation_events to authenticated;

create table if not exists public.storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id in ('route-media', 'appearance-submissions')),
  object_path text not null,
  requested_by uuid references auth.users(id) on delete set null,
  context text not null,
  last_error text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(bucket_id, object_path)
);
alter table public.storage_cleanup_jobs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz;
create index if not exists storage_cleanup_pending_idx
  on public.storage_cleanup_jobs(next_attempt_at, created_at) where completed_at is null;
alter table public.storage_cleanup_jobs enable row level security;
drop policy if exists storage_cleanup_admin_read on public.storage_cleanup_jobs;
create policy storage_cleanup_admin_read
on public.storage_cleanup_jobs for select to authenticated
using (public.netrin_is_admin());
revoke all on public.storage_cleanup_jobs from anon, authenticated;
grant select on public.storage_cleanup_jobs to authenticated;

-- Replace all route policies so approved content is public, authors can read
-- their own submissions, and only RPCs/admins can mutate cloud submissions.
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('routes', 'route_points', 'route_point_media')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

create policy routes_visible_read
on public.routes for select to anon, authenticated
using (
  (moderation_status = 'approved' and deleted_at is null)
  or created_by = auth.uid()
  or public.netrin_is_admin()
);

create policy route_points_visible_read
on public.route_points for select to anon, authenticated
using (exists (
  select 1 from public.routes r where r.id = route_points.route_id
    and (
      (r.moderation_status = 'approved' and r.deleted_at is null)
      or r.created_by = auth.uid()
      or public.netrin_is_admin()
    )
));

create policy route_point_media_visible_read
on public.route_point_media for select to anon, authenticated
using (exists (
  select 1 from public.route_points p
  join public.routes r on r.id = p.route_id
  where p.id = route_point_media.point_id
    and (
      (r.moderation_status = 'approved' and r.deleted_at is null)
      or r.created_by = auth.uid()
      or public.netrin_is_admin()
    )
));

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
              'mimeType', m.mime_type,
              'width', m.width,
              'height', m.height
            ) order by m.sort_order
          ) from public.route_point_media m where m.point_id = p.id
        ), '[]'::jsonb)
      ) order by p.sort_order
    ) from public.route_points p where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.moderation_status = 'approved' and r.deleted_at is null;

revoke all on public.routes, public.route_points, public.route_point_media from anon, authenticated;
revoke all on public.routes_public_v2 from anon, authenticated;
grant select on public.routes_public_v2 to anon, authenticated;

drop view if exists public.routes_admin_v1;
create view public.routes_admin_v1
with (security_invoker = off) as
select
  r.id, r.created_by, r.author, r.title, r.description, r.moderation_status,
  r.rejection_reason, r.created_at, r.updated_at, r.reviewed_at, r.reviewed_by,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id, 'order', p.sort_order,
        'lng', public.st_x(p.location), 'lat', public.st_y(p.location),
        'title', p.title, 'text', p.note, 'speciesName', nullif(p.species_name, ''),
        'media', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'order', m.sort_order, 'storagePath', m.storage_path,
            'mimeType', m.mime_type, 'width', m.width, 'height', m.height
          ) order by m.sort_order)
          from public.route_point_media m where m.point_id=p.id
        ), '[]'::jsonb)
      ) order by p.sort_order
    ) from public.route_points p where p.route_id=r.id
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

create or replace function public.route_submission_exists(p_route_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.routes
    where id = p_route_id and created_by = auth.uid()
  );
$$;
revoke all on function public.route_submission_exists(uuid) from public, anon, authenticated;
grant execute on function public.route_submission_exists(uuid) to authenticated;

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
begin
  if p_points is null or jsonb_typeof(p_points) <> 'array'
    or jsonb_array_length(p_points) < 2 or jsonb_array_length(p_points) > 200 then
    raise exception 'route needs between 2 and 200 points';
  end if;
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
    insert into public.route_points(id, route_id, sort_order, location, title, species_name, note)
    values (
      v_point_id, p_route_id, v_point_record.ordinal,
      public.st_setsrid(public.st_makepoint(v_lng, v_lat), 4326),
      left(coalesce(v_point ->> 'title', ''), 120),
      left(coalesce(v_point ->> 'speciesName', ''), 160),
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
revoke all on function public.netrin_replace_route_points(uuid, jsonb, uuid, boolean) from public, anon, authenticated;

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
    moderation_status, rejection_reason, reviewed_at, reviewed_by, updated_at, deleted_at
  ) values (
    p_route_id, v_uid, left(coalesce(v_author, ''), 80), coalesce(p_title, '{}'::jsonb),
    coalesce(p_description, '{}'::jsonb), false, false, 'pending', null, null, null, now(), null
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
  perform public.netrin_replace_route_points(v_route_id, p_points, v_uid, true);
  return v_route_id;
end;
$$;
revoke all on function public.submit_route_v3(uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_route_v3(uuid, jsonb, jsonb, text, jsonb) to authenticated;

-- Compatibility gate for stale PWA clients: the legacy name can no longer
-- publish publicly or create/use an anonymous identity.
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
revoke all on function public.publish_route_v2(uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_route_v2(uuid, jsonb, jsonb, text, jsonb) to authenticated;

create or replace function public.review_route(
  p_route_id uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_before jsonb; v_after jsonb;
begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid review decision'; end if;
  if p_decision = 'rejected' and nullif(trim(p_reason), '') is null then
    raise exception 'rejection reason required';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'review reason too long'; end if;
  select to_jsonb(r) into v_before from public.routes r where id = p_route_id for update;
  if v_before is null then raise exception 'route not found'; end if;
  update public.routes set
    moderation_status = p_decision,
    is_public = (p_decision = 'approved'),
    rejection_reason = case when p_decision = 'rejected' then nullif(trim(p_reason), '') else null end,
    reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now(), deleted_at = null
  where id = p_route_id;
  select to_jsonb(r) into v_after from public.routes r where id = p_route_id;
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, before_state, after_state, note)
  values (auth.uid(), 'route', p_route_id::text, p_decision, v_before, v_after, nullif(trim(p_reason), ''));
end;
$$;
revoke all on function public.review_route(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_route(uuid, text, text) to authenticated;

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
revoke all on function public.admin_save_route(uuid, jsonb, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_save_route(uuid, jsonb, jsonb, text, jsonb, text) to authenticated;

create or replace function public.admin_delete_route(p_route_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_before jsonb;
begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  select to_jsonb(r) into v_before from public.routes r where id = p_route_id for update;
  if v_before is null then raise exception 'route not found'; end if;
  insert into public.storage_cleanup_jobs(bucket_id, object_path, requested_by, context)
  select 'route-media', m.storage_path, auth.uid(), 'delete-route:' || p_route_id::text
  from public.route_point_media m
  join public.route_points rp on rp.id = m.point_id
  where rp.route_id = $1
  on conflict(bucket_id, object_path) do update set
    requested_by = excluded.requested_by, context = excluded.context,
    last_error = null, completed_at = null, next_attempt_at = now(), locked_at = null;
  delete from public.routes where id = p_route_id;
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, before_state, note)
  values (auth.uid(), 'route', p_route_id::text, 'delete', v_before, nullif(trim(p_reason), ''));
end;
$$;
revoke all on function public.admin_delete_route(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_route(uuid, text) to authenticated;

create table if not exists public.appearance_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  package_id text not null check (package_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(package_id) <= 80),
  package_version text not null check (char_length(package_version) between 1 and 80),
  display_name text not null check (char_length(display_name) between 1 and 80),
  summary text not null default '' check (char_length(summary) <= 500),
  declared_author text not null check (char_length(declared_author) between 1 and 80),
  license text not null check (char_length(license) between 1 and 80),
  package_sha256 text not null check (package_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 1 and 5242880),
  storage_path text not null unique,
  audit_report jsonb not null,
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, package_id, package_version)
);
create index if not exists appearance_moderation_queue_idx
  on public.appearance_submissions(moderation_status, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'appearance-submissions', 'appearance-submissions', false, 5242880,
  array['application/zip', 'application/octet-stream', 'application/vnd.netrin.appearance+zip']
)
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.appearance_submissions enable row level security;
drop policy if exists appearance_read_owner_admin_approved on public.appearance_submissions;
create policy appearance_read_owner_admin_approved
on public.appearance_submissions for select to anon, authenticated
using (
  moderation_status = 'approved'
  or owner_id = auth.uid()
  or public.netrin_is_admin()
);
revoke all on public.appearance_submissions from anon, authenticated;

drop view if exists public.appearance_catalog_public;
create view public.appearance_catalog_public
with (security_invoker = off) as
select id, package_id, package_version, display_name, summary, declared_author,
  license, package_sha256, byte_size, reviewed_at, updated_at
from public.appearance_submissions
where moderation_status = 'approved';
revoke all on public.appearance_catalog_public from anon, authenticated;
grant select on public.appearance_catalog_public to anon, authenticated;

drop view if exists public.appearance_submissions_private_v1;
create view public.appearance_submissions_private_v1
with (security_invoker = off) as
select * from public.appearance_submissions
where owner_id = auth.uid() or public.netrin_is_admin();
revoke all on public.appearance_submissions_private_v1 from anon, authenticated;
grant select on public.appearance_submissions_private_v1 to authenticated;

create or replace function public.review_appearance(
  p_submission_id uuid,
  p_decision text,
  p_reason text default null,
  p_display_name text default null,
  p_summary text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_before jsonb; v_after jsonb;
begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid review decision'; end if;
  if p_decision = 'rejected' and nullif(trim(p_reason), '') is null then
    raise exception 'rejection reason required';
  end if;
  if char_length(coalesce(p_reason, '')) > 500
    or char_length(coalesce(p_display_name, '')) > 80
    or char_length(coalesce(p_summary, '')) > 500 then
    raise exception 'appearance review text too long';
  end if;
  select to_jsonb(a) into v_before from public.appearance_submissions a where id = p_submission_id for update;
  if v_before is null then raise exception 'appearance not found'; end if;
  update public.appearance_submissions set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    summary = coalesce(p_summary, summary), moderation_status = p_decision,
    rejection_reason = case when p_decision = 'rejected' then nullif(trim(p_reason), '') else null end,
    reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  where id = p_submission_id;
  select to_jsonb(a) into v_after from public.appearance_submissions a where id = p_submission_id;
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, before_state, after_state, note)
  values (auth.uid(), 'appearance', p_submission_id::text, p_decision, v_before, v_after, nullif(trim(p_reason), ''));
end;
$$;
revoke all on function public.review_appearance(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.review_appearance(uuid, text, text, text, text) to authenticated;

create or replace function public.admin_delete_appearance(
  p_submission_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_before jsonb; v_path text;
begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  select to_jsonb(a), a.storage_path into v_before, v_path
  from public.appearance_submissions a where id = p_submission_id for update;
  if v_before is null then raise exception 'appearance not found'; end if;
  insert into public.storage_cleanup_jobs(bucket_id, object_path, requested_by, context)
  values ('appearance-submissions', v_path, auth.uid(), 'delete-appearance:' || p_submission_id::text)
  on conflict(bucket_id, object_path) do update set
    requested_by = excluded.requested_by, context = excluded.context,
    last_error = null, completed_at = null, next_attempt_at = now(), locked_at = null;
  delete from public.appearance_submissions where id = p_submission_id;
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, before_state, note)
  values (auth.uid(), 'appearance', p_submission_id::text, 'delete', v_before, nullif(trim(p_reason), ''));
end;
$$;
revoke all on function public.admin_delete_appearance(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_appearance(uuid, text) to authenticated;

create or replace function public.admin_prepare_delete_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_target_admin boolean; v_admin_count integer;
begin
  if not public.netrin_is_admin(v_actor) then raise exception 'admin required'; end if;
  if p_target_id = v_actor then raise exception 'cannot delete current administrator'; end if;
  select exists(select 1 from public.user_roles where user_id=p_target_id and role='admin') into v_target_admin;
  select count(*) into v_admin_count from public.user_roles where role='admin';
  if v_target_admin and v_admin_count <= 1 then raise exception 'cannot delete last administrator'; end if;
  update public.profiles set account_status = 'deleting', updated_at = now() where id = p_target_id;
  insert into public.storage_cleanup_jobs(bucket_id, object_path, requested_by, context)
  select 'route-media', m.storage_path, v_actor, 'delete-user:' || p_target_id::text
  from public.route_point_media m
  join public.route_points p on p.id = m.point_id
  join public.routes r on r.id = p.route_id
  where r.created_by = p_target_id and r.moderation_status in ('pending','rejected')
  on conflict(bucket_id, object_path) do update set
    requested_by = excluded.requested_by, context = excluded.context,
    last_error = null, completed_at = null, next_attempt_at = now(), locked_at = null;
  insert into public.storage_cleanup_jobs(bucket_id, object_path, requested_by, context)
  select 'appearance-submissions', a.storage_path, v_actor, 'delete-user:' || p_target_id::text
  from public.appearance_submissions a
  where a.owner_id = p_target_id and a.moderation_status in ('pending','rejected')
  on conflict(bucket_id, object_path) do update set
    requested_by = excluded.requested_by, context = excluded.context,
    last_error = null, completed_at = null, next_attempt_at = now(), locked_at = null;
  update public.routes set created_by = null, author = '已注销用户', updated_at = now()
    where created_by = p_target_id and moderation_status = 'approved';
  delete from public.routes where created_by = p_target_id and moderation_status in ('pending','rejected');
  update public.appearance_submissions set owner_id = null, updated_at = now()
    where owner_id = p_target_id and moderation_status = 'approved';
  delete from public.appearance_submissions where owner_id = p_target_id and moderation_status in ('pending','rejected');
  insert into public.moderation_events(actor_id, subject_type, subject_id, action, note)
  values (v_actor, 'account', p_target_id::text, 'hard-delete', 'approved content anonymized; unpublished content removed');
end;
$$;
revoke all on function public.admin_prepare_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_prepare_delete_user(uuid) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
