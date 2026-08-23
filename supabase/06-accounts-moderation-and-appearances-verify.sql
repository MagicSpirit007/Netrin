-- Read-only verification after 06-accounts-moderation-and-appearances.sql.
-- Run on the server and report the output before frontend rollout:
--   docker exec -i supabase-db psql -U postgres -d postgres < 06-accounts-moderation-and-appearances-verify.sql

\pset pager off

select 'content_counts' as check_name,
  (select count(*) from public.routes) as routes,
  (select count(*) from public.route_points) as points,
  (select count(*) from public.route_point_media) as media,
  (select count(*) from public.routes_public_v2) as public_routes;

select 'moderation_backfill' as check_name,
  count(*) filter (where moderation_status='approved') as approved,
  count(*) filter (where moderation_status='pending') as pending,
  count(*) filter (where moderation_status='rejected') as rejected,
  count(*) filter (where moderation_status is null) as null_status
from public.routes;

select 'route_integrity' as check_name,
  count(*) filter (where public.st_srid(location) <> 4326) as wrong_srid,
  count(*) filter (where public.st_x(location) not between -180 and 180
                    or public.st_y(location) not between -90 and 90) as invalid_coordinates,
  (select count(*) from (
    select route_id, sort_order from public.route_points
    group by route_id, sort_order having count(*) > 1
  ) d) as duplicate_point_order,
  (select count(*) from (
    select point_id, sort_order from public.route_point_media
    group by point_id, sort_order having count(*) > 1
  ) d) as duplicate_media_order,
  (select count(*) from (
    select point_id from public.route_point_media group by point_id having count(*) > 8
  ) d) as points_over_eight_media
from public.route_points;

select 'storage_references' as check_name,
  count(*) filter (where o.name is null) as missing_route_objects,
  (select count(*) from storage.objects so
    left join public.route_point_media rpm on rpm.storage_path = so.name
    where so.bucket_id='route-media' and rpm.id is null) as orphan_route_objects
from public.route_point_media m
left join storage.objects o on o.bucket_id='route-media' and o.name=m.storage_path;

select 'security_contract' as check_name,
  has_function_privilege('anon', 'public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)', 'execute') as anon_submit,
  has_function_privilege('authenticated', 'public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)', 'execute') as authenticated_submit,
  has_table_privilege('anon', 'public.routes', 'select') as anon_routes_base_read,
  has_table_privilege('authenticated', 'public.routes', 'select') as authenticated_routes_base_read,
  has_table_privilege('anon', 'public.route_points', 'select') as anon_points_base_read,
  has_table_privilege('authenticated', 'public.route_points', 'select') as authenticated_points_base_read,
  has_table_privilege('anon', 'public.route_point_media', 'select') as anon_media_base_read,
  has_table_privilege('authenticated', 'public.route_point_media', 'select') as authenticated_media_base_read,
  has_table_privilege('anon', 'public.routes_public_v2', 'select') as anon_public_projection_read,
  has_table_privilege('anon', 'public.routes_owned_v1', 'select') as anon_owned_projection_read,
  has_table_privilege('authenticated', 'public.routes_owned_v1', 'select') as authenticated_owned_projection_read,
  has_table_privilege('anon', 'public.routes_admin_v1', 'select') as anon_admin_projection_read,
  has_table_privilege('authenticated', 'public.routes_admin_v1', 'select') as authenticated_admin_projection_read,
  has_table_privilege('anon', 'public.user_roles', 'select') as anon_role_read,
  has_table_privilege('authenticated', 'public.user_roles', 'insert') as client_role_insert;

select 'storage_buckets' as check_name, id, public, file_size_limit, allowed_mime_types
from storage.buckets where id in ('route-media', 'appearance-submissions') order by id;

select 'projection_leaks' as check_name,
  count(*) filter (where points::text like '%storagePath%') as public_routes_with_storage_path,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='routes_public_v2'
      and column_name in ('created_by','moderation_status','rejection_reason','reviewed_at','reviewed_by','deleted_at'))
    as public_projection_forbidden_columns,
  has_table_privilege('anon', 'public.appearance_submissions', 'select') as anon_appearance_base_read,
  has_table_privilege('authenticated', 'public.appearance_submissions', 'select') as authenticated_appearance_base_read,
  has_table_privilege('anon', 'public.appearance_catalog_public', 'select') as anon_appearance_catalog_read
from public.routes_public_v2;

select 'security_functions' as check_name,
  to_regprocedure('public.route_submission_exists(uuid)') is not null as route_commit_reconciliation,
  has_function_privilege('anon', 'public.route_submission_exists(uuid)', 'execute') as anon_route_commit_reconciliation,
  has_function_privilege('authenticated', 'public.route_submission_exists(uuid)', 'execute') as authenticated_route_commit_reconciliation,
  to_regprocedure('public.netrin_route_media_is_unclaimed(text)') is not null as route_media_unclaimed_guard,
  has_function_privilege(
    'anon',
    'public.netrin_route_media_is_unclaimed(text)',
    'execute'
  ) as anon_unclaimed_guard_execute,
  has_function_privilege(
    'authenticated',
    'public.netrin_route_media_is_unclaimed(text)',
    'execute'
  ) as authenticated_unclaimed_guard_execute,
  to_regprocedure('public.admin_delete_appearance(uuid,text)') is not null as transactional_appearance_delete,
  has_function_privilege('anon', 'public.admin_delete_appearance(uuid,text)', 'execute') as anon_transactional_appearance_delete,
  to_regprocedure('public.admin_prepare_delete_user(uuid)') is not null as retryable_account_delete,
  has_function_privilege('anon', 'public.admin_prepare_delete_user(uuid)', 'execute') as anon_retryable_account_delete;

-- Expected rows: INSERT + DELETE for authenticated only. There must be no
-- SELECT/public-read or UPDATE/upsert policy after the private-bucket cutover.
select 'route_media_storage_policies' as check_name,
  policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'route_media_%'
order by policyname;

select 'pending_storage_cleanup' as check_name, count(*) as pending_jobs
from public.storage_cleanup_jobs where completed_at is null;
