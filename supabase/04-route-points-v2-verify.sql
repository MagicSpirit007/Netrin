-- Read-only reconciliation after 04-route-points-v2-expand.sql and before 05.
-- This script changes no rows or schema objects.

\pset pager off

select 'routes' as metric, count(*)::bigint as value from public.routes
union all
select 'legacy_stops', coalesce(sum(jsonb_array_length(coalesce(stops, '[]'::jsonb))), 0)::bigint
from public.routes
union all
select 'route_points', count(*)::bigint from public.route_points
union all
select 'legacy_media_refs', count(*)::bigint
from public.routes r
cross join lateral jsonb_array_elements(coalesce(r.stops, '[]'::jsonb)) as stop(item)
where nullif(stop.item ->> 'photo', '') is not null
union all
select 'route_point_media', count(*)::bigint from public.route_point_media
order by metric;

select r.id, jsonb_array_length(coalesce(r.stops, '[]'::jsonb)) as legacy_points,
       count(p.id)::integer as v2_points
from public.routes r
left join public.route_points p on p.route_id = r.id
group by r.id, r.stops
having jsonb_array_length(coalesce(r.stops, '[]'::jsonb)) <> count(p.id);

select p.route_id, p.id as point_id, p.sort_order, public.st_astext(p.location) as location
from public.route_points p
where public.st_x(p.location) not between -180 and 180
   or public.st_y(p.location) not between -90 and 90;

select route_id, sort_order, count(*)::integer as duplicate_count
from public.route_points
group by route_id, sort_order
having count(*) > 1;

select p.route_id, p.id as point_id, count(m.id)::integer as media_count
from public.route_points p
left join public.route_point_media m on m.point_id = p.id
group by p.route_id, p.id
having count(m.id) > 8;

-- Legacy Storage paths predate route/point UUID segments. They must belong to
-- the route owner; publish_route_v2 enforces the stricter owner/route/point
-- prefix for every new v2 upload.
select r.id as route_id, p.id as point_id, m.storage_path
from public.route_point_media m
join public.route_points p on p.id = m.point_id
join public.routes r on r.id = p.route_id
where position(format('routes/%s/', r.created_by) in m.storage_path) <> 1;

select id, title, jsonb_array_length(points) as point_count
from public.routes_public_v2
order by created_at desc
limit 10;
