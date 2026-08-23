-- Read-only verification after 05-route-points-v2-contract.sql.
-- Zero rows from the first three queries is the expected result.

\pset pager off

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'routes'
  and column_name in ('geom', 'stops', 'distance', 'duration', 'season', 'difficulty', 'tags')
order by column_name;

select table_schema, table_name
from information_schema.views
where table_schema = 'public' and table_name = 'routes_public';

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'publish_route';

select 'routes' as metric, count(*)::bigint as value from public.routes
union all
select 'route_points', count(*)::bigint from public.route_points
union all
select 'route_point_media', count(*)::bigint from public.route_point_media
union all
select 'public_routes_v2', count(*)::bigint from public.routes_public_v2
order by metric;
