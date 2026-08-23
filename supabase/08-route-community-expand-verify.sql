-- Read-only verification after 08-route-community-expand.sql.
-- No DDL/DML. Does not change rows or schema objects.
--
-- Optional operator baseline (pre-expand counts). Pass via psql -v:
--   -v expected_routes=N
--   -v expected_points=N
--   -v expected_media=N
--   -v expected_storage_paths=N
-- When a variable is unset, the matching "matches_expected" boolean is null
-- (not a failure); when set, true means count equals the baseline.
--
--   docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 \
--     -v expected_routes=2 -v expected_points=29 \
--     -v expected_media=28 -v expected_storage_paths=28 \
--     -U postgres -d postgres < 08-route-community-expand-verify.sql

\pset pager off

-- Optional baselines: if operator did not pass -v, treat as empty and skip match.
\if :{?expected_routes}
\else
\set expected_routes
\endif
\if :{?expected_points}
\else
\set expected_points
\endif
\if :{?expected_media}
\else
\set expected_media
\endif
\if :{?expected_storage_paths}
\else
\set expected_storage_paths
\endif

-- ---------------------------------------------------------------------------
-- 1. Content counts vs optional baseline
-- ---------------------------------------------------------------------------

select 'content_counts' as check_name,
  (select count(*) from public.routes) as routes,
  (select count(*) from public.route_points) as points,
  (select count(*) from public.route_point_media) as media,
  (select count(distinct storage_path)
     from public.route_point_media
    where storage_path is not null) as distinct_storage_paths,
  (select count(*) from public.routes_public_v2) as public_routes_v2,
  (select count(*) from public.routes
    where moderation_status = 'approved'
      and deleted_at is null
      and line_geom is not null
      and needs_geometry_review = false) as navigable_routes,
  case when length(:'expected_routes') = 0 then null
       else (select count(*) from public.routes) = :'expected_routes'::bigint
  end as routes_match_expected,
  case when length(:'expected_points') = 0 then null
       else (select count(*) from public.route_points) = :'expected_points'::bigint
  end as points_match_expected,
  case when length(:'expected_media') = 0 then null
       else (select count(*) from public.route_point_media) = :'expected_media'::bigint
  end as media_match_expected,
  case when length(:'expected_storage_paths') = 0 then null
       else (select count(distinct storage_path)
               from public.route_point_media
              where storage_path is not null) = :'expected_storage_paths'::bigint
  end as storage_paths_match_expected;

-- ---------------------------------------------------------------------------
-- 2. highlight_title backfill + category + species_name kept
-- ---------------------------------------------------------------------------

select 'highlight_backfill' as check_name,
  count(*) filter (where highlight_title is null) as null_highlight_title,
  count(*) filter (
    where coalesce(nullif(trim(species_name), ''), '') <> ''
      and highlight_title <> left(trim(species_name), 160)
  ) as species_mismatch,
  count(*) filter (
    where coalesce(nullif(trim(species_name), ''), '') = ''
      and coalesce(nullif(trim(title), ''), '') <> ''
      and highlight_title <> left(trim(title), 160)
  ) as title_fallback_mismatch,
  count(*) filter (
    where coalesce(nullif(trim(species_name), ''), '') = ''
      and coalesce(nullif(trim(title), ''), '') = ''
      and highlight_title <> ''
  ) as empty_source_nonempty_highlight,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'route_points'
      and column_name = 'species_name'
  ) as species_name_kept,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'route_points'
      and column_name = 'highlight_title'
  ) as highlight_title_present,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'route_points'
      and column_name = 'category' and is_nullable = 'YES'
  ) as category_nullable
from public.route_points;

-- ---------------------------------------------------------------------------
-- 3. Route meta columns, enums, tags, needs_geometry_review, geometry bounds
-- ---------------------------------------------------------------------------

select 'route_meta_columns' as check_name,
  count(*) filter (where travel_mode is null) as null_travel_mode,
  count(*) filter (where travel_mode not in ('walking', 'cycling')) as invalid_travel_mode,
  count(*) filter (
    where geometry_source is not null
      and geometry_source not in (
        'amap-planned', 'field-recorded', 'gpx-import',
        'geojson-import', 'legacy-point-chain'
      )
  ) as invalid_geometry_source,
  count(*) filter (
    where difficulty is not null
      and difficulty not in ('easy', 'moderate', 'hard')
  ) as invalid_difficulty,
  count(*) filter (where needs_geometry_review is null) as null_needs_review,
  count(*) filter (
    where line_geom is not null and public.st_srid(line_geom) <> 4326
  ) as bad_line_srid,
  count(*) filter (
    where line_geom is not null
      and public.geometrytype(line_geom) <> 'LINESTRING'
  ) as non_linestring,
  count(*) filter (
    where line_geom is not null
      and (
        public.st_npoints(line_geom) < 2
        or public.st_npoints(line_geom) > 10000
      )
  ) as bad_vertex_count,
  count(*) filter (
    where line_geom is not null
      and (
        start_location is null or end_location is null
        or bbox_min_lng is null or bbox_min_lat is null
        or bbox_max_lng is null or bbox_max_lat is null
      )
  ) as geometry_missing_derived,
  count(*) filter (
    where line_geom is not null
      and (
        abs(public.st_x(start_location) - public.st_x(public.st_startpoint(line_geom))) > 1e-9
        or abs(public.st_y(start_location) - public.st_y(public.st_startpoint(line_geom))) > 1e-9
        or abs(public.st_x(end_location) - public.st_x(public.st_endpoint(line_geom))) > 1e-9
        or abs(public.st_y(end_location) - public.st_y(public.st_endpoint(line_geom))) > 1e-9
        or abs(bbox_min_lng - public.st_xmin(line_geom)) > 1e-9
        or abs(bbox_min_lat - public.st_ymin(line_geom)) > 1e-9
        or abs(bbox_max_lng - public.st_xmax(line_geom)) > 1e-9
        or abs(bbox_max_lat - public.st_ymax(line_geom)) > 1e-9
      )
  ) as geometry_derived_mismatch,
  count(*) filter (where not public.netrin_route_tags_valid(tags)) as invalid_tags,
  count(*) filter (where cardinality(tags) > 10) as tags_over_ten,
  (
    select count(*) = 1 from pg_constraint
    where conrelid = 'public.routes'::regclass
      and conname = 'routes_cover_media_id_fkey'
  ) as cover_fk_present,
  count(*) filter (
    where cover_media_id is not null
      and not exists (
        select 1
        from public.route_point_media m
        join public.route_points p on p.id = m.point_id
        where m.id = routes.cover_media_id and p.route_id = routes.id
      )
  ) as orphan_cover_media
from public.routes;

-- ---------------------------------------------------------------------------
-- 4. Objects present (discovery is a function, not a view/table)
-- ---------------------------------------------------------------------------

select 'objects_present' as check_name,
  to_regclass('public.routes_public_v2') is not null as routes_public_v2,
  to_regclass('public.routes_owned_v1') is not null as routes_owned_v1,
  to_regclass('public.routes_owned_v2') is not null as routes_owned_v2,
  to_regclass('public.routes_admin_v1') is not null as routes_admin_v1,
  to_regclass('public.routes_discovery_v1') is null as discovery_not_relation,
  to_regprocedure(
    'public.routes_discovery_v1(timestamptz,uuid,integer,text,text,integer,integer,integer,integer,text,text[],double precision,double precision,double precision,double precision)'
  ) is not null as routes_discovery_v1_fn,
  to_regprocedure('public.get_route_detail_v1(uuid)') is not null as get_route_detail_v1,
  to_regprocedure('public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)') is not null as submit_route_v3,
  to_regprocedure('public.submit_route_v4(uuid,jsonb,jsonb,jsonb,jsonb)') is not null as submit_route_v4,
  to_regprocedure('public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb)') is not null as publish_route_v2,
  to_regprocedure('public.netrin_route_tags_valid(text[])') is not null as tags_helper,
  to_regprocedure(
    'public.netrin_route_bbox_json(double precision,double precision,double precision,double precision)'
  ) is not null as bbox_helper_numeric,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'routes'
      and column_name = 'line_geom'
  ) as line_geom_present,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'routes'
      and column_name = 'needs_geometry_review'
  ) as needs_geometry_review_present,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'routes'
      and column_name in ('bbox_min_lng', 'bbox_min_lat', 'bbox_max_lng', 'bbox_max_lat')
    having count(*) = 4
  ) as numeric_bbox_present;

-- ---------------------------------------------------------------------------
-- 5. Security / privilege matrix
-- ---------------------------------------------------------------------------

select 'security_contract' as check_name,
  has_function_privilege(
    'anon',
    'public.routes_discovery_v1(timestamptz,uuid,integer,text,text,integer,integer,integer,integer,text,text[],double precision,double precision,double precision,double precision)',
    'execute'
  ) as anon_discovery_exec,
  has_function_privilege(
    'authenticated',
    'public.routes_discovery_v1(timestamptz,uuid,integer,text,text,integer,integer,integer,integer,text,text[],double precision,double precision,double precision,double precision)',
    'execute'
  ) as auth_discovery_exec,
  has_function_privilege('anon', 'public.get_route_detail_v1(uuid)', 'execute') as anon_detail,
  has_function_privilege('authenticated', 'public.get_route_detail_v1(uuid)', 'execute') as auth_detail,
  has_function_privilege('anon', 'public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)', 'execute') as anon_submit_v3,
  has_function_privilege('authenticated', 'public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)', 'execute') as auth_submit_v3,
  has_function_privilege('anon', 'public.submit_route_v4(uuid,jsonb,jsonb,jsonb,jsonb)', 'execute') as anon_submit_v4,
  has_function_privilege('authenticated', 'public.submit_route_v4(uuid,jsonb,jsonb,jsonb,jsonb)', 'execute') as auth_submit_v4,
  has_function_privilege('anon', 'public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb)', 'execute') as anon_publish_v2,
  has_function_privilege('authenticated', 'public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb)', 'execute') as auth_publish_v2,
  has_function_privilege('anon', 'public.netrin_apply_route_meta(uuid,jsonb)', 'execute') as anon_apply_meta,
  has_function_privilege('authenticated', 'public.netrin_apply_route_meta(uuid,jsonb)', 'execute') as auth_apply_meta,
  has_function_privilege('anon', 'public.netrin_replace_route_points(uuid,jsonb,uuid,boolean)', 'execute') as anon_replace_points,
  has_function_privilege('authenticated', 'public.netrin_replace_route_points(uuid,jsonb,uuid,boolean)', 'execute') as auth_replace_points,
  has_function_privilege('anon', 'public.netrin_route_tags_valid(text[])', 'execute') as anon_tags_helper,
  has_function_privilege('authenticated', 'public.netrin_route_tags_valid(text[])', 'execute') as auth_tags_helper,
  has_table_privilege('anon', 'public.routes', 'select') as anon_routes_base_read,
  has_table_privilege('authenticated', 'public.routes', 'select') as auth_routes_base_read,
  has_table_privilege('anon', 'public.route_points', 'select') as anon_points_base_read,
  has_table_privilege('authenticated', 'public.route_points', 'select') as auth_points_base_read,
  has_table_privilege('anon', 'public.route_point_media', 'select') as anon_media_base_read,
  has_table_privilege('authenticated', 'public.route_point_media', 'select') as auth_media_base_read,
  has_table_privilege('anon', 'public.routes_public_v2', 'select') as anon_public_v2,
  has_table_privilege('authenticated', 'public.routes_public_v2', 'select') as auth_public_v2,
  has_table_privilege('anon', 'public.routes_owned_v1', 'select') as anon_owned_v1,
  has_table_privilege('authenticated', 'public.routes_owned_v1', 'select') as auth_owned_v1,
  has_table_privilege('anon', 'public.routes_owned_v2', 'select') as anon_owned_v2,
  has_table_privilege('authenticated', 'public.routes_owned_v2', 'select') as auth_owned_v2,
  has_table_privilege('anon', 'public.routes_admin_v1', 'select') as anon_admin;

-- ---------------------------------------------------------------------------
-- 6. Public projection leaks + dual-read + navigable filters
-- ---------------------------------------------------------------------------

select 'projection_leaks' as check_name,
  count(*) filter (where points::text like '%storagePath%') as public_v2_storage_path,
  count(*) filter (where points::text like '%created_by%') as public_v2_created_by,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'routes_public_v2'
      and column_name in (
        'created_by', 'moderation_status', 'rejection_reason',
        'reviewed_at', 'reviewed_by', 'deleted_at', 'line_geom',
        'needs_geometry_review'
      )) as public_v2_forbidden_columns
from public.routes_public_v2;

select 'discovery_rpc' as check_name,
  (select count(*) from public.routes_discovery_v1()) as discovery_row_count,
  (select count(*) from public.routes_discovery_v1())
    = (select count(*) from public.routes
        where moderation_status = 'approved'
          and deleted_at is null
          and line_geom is not null
          and needs_geometry_review = false) as discovery_matches_navigable,
  coalesce((
    select bool_and(
      d::text not like '%storagePath%'
      and d::text not like '%created_by%'
      and d::text not like '%moderation_status%'
      and d::text not like '%rejection_reason%'
    )
    from public.routes_discovery_v1() as d
  ), true) as discovery_no_leaks;

select 'detail_rpc' as check_name,
  coalesce((
    select bool_and(
      detail is null
      or (
        detail::text not like '%storagePath%'
        and detail::text not like '%created_by%'
        and detail::text not like '%moderation_status%'
        and detail::text not like '%rejection_reason%'
        and detail::text not like '%reviewed_by%'
      )
    )
    from (
      select public.get_route_detail_v1(r.id) as detail
      from public.routes r
      where r.moderation_status = 'approved'
        and r.deleted_at is null
        and r.line_geom is not null
        and r.needs_geometry_review = false
      limit 20
    ) s
  ), true) as detail_no_leaks,
  coalesce((
    select count(*) = 0
    from public.routes r
    where (
      r.moderation_status <> 'approved'
      or r.deleted_at is not null
      or r.line_geom is null
      or r.needs_geometry_review = true
    )
    and public.get_route_detail_v1(r.id) is not null
  ), true) as detail_hides_non_navigable;

select 'dual_read_contract' as check_name,
  (
    select count(*) = 0
    from public.routes_public_v2 r
    cross join lateral jsonb_array_elements(r.points) as point(value)
    where (
      nullif(point.value ->> 'speciesName', '') is not null
      and nullif(point.value ->> 'highlightTitle', '') is null
    ) or (
      nullif(point.value ->> 'highlightTitle', '') is not null
      and nullif(point.value ->> 'speciesName', '') is null
      and nullif(point.value ->> 'highlightTitle', '')
        <> nullif(point.value ->> 'title', '')
    )
  ) as public_v2_titles_paired;

-- ---------------------------------------------------------------------------
-- 7. No social tables (M5 out of scope)
-- ---------------------------------------------------------------------------

select 'no_social_tables' as check_name,
  to_regclass('public.user_follows') is null as no_user_follows,
  to_regclass('public.route_bookmarks') is null as no_route_bookmarks,
  to_regclass('public.route_likes') is null as no_route_likes,
  to_regclass('public.comments') is null as no_comments,
  to_regclass('public.content_reports') is null as no_content_reports,
  to_regclass('public.notifications') is null as no_notifications;

-- Expected (when baseline vars supplied and expand succeeded):
-- content_counts.*_match_expected = true (or null if var omitted)
-- highlight_backfill: null_highlight_title=0, species/title/empty mismatches=0,
--   species_name_kept/highlight_title_present/category_nullable = true
-- route_meta_columns: all invalid/null/bad_* = 0; cover_fk_present = true
-- objects_present: discovery_not_relation = true; routes_discovery_v1_fn = true;
--   other objects true
-- security_contract:
--   anon/auth discovery+detail = true
--   anon submit/publish/helpers = false; auth submit/publish = true
--   auth helpers = false
--   base table reads = false
--   anon/auth public_v2 = true; anon owned/admin = false; auth owned = true
-- projection_leaks: all 0
-- discovery_rpc: discovery_matches_navigable = true, discovery_no_leaks = true
-- detail_rpc: detail_no_leaks = true, detail_hides_non_navigable = true
-- dual_read_contract: public_v2_titles_paired = true
-- no_social_tables: all true
--
-- This script does NOT run mutation negative tests (anonymous write, suspended
-- account, cross-route cover, invalid geometry). Those are manual operator
-- checks listed in docs/ROUTE_COMMUNITY_M1_RUNBOOK.md.
