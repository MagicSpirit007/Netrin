-- Netrin route media storage bucket + policies.
--
-- The frontend uploads key-point photos to Supabase Storage bucket route-media:
--   routes/<auth.uid>/<draft-id>/<point-id>.jpg
--
-- Copy this file to the self-hosted Supabase server, then run it manually:
--   docker exec -i supabase-db psql -U postgres -d postgres < 03-route-media-storage.sql
--
-- This migration is idempotent. The AI CLI must not execute it over SSH.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'route-media',
  'route-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists route_media_public_read on storage.objects;
drop policy if exists route_media_auth_insert on storage.objects;
drop policy if exists route_media_auth_update on storage.objects;
drop policy if exists route_media_auth_delete on storage.objects;

create policy route_media_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'route-media');

create policy route_media_auth_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'route-media'
  and (storage.foldername(name))[1] = 'routes'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy route_media_auth_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'route-media'
  and (storage.foldername(name))[1] = 'routes'
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'route-media'
  and (storage.foldername(name))[1] = 'routes'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy route_media_auth_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'route-media'
  and (storage.foldername(name))[1] = 'routes'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

commit;
