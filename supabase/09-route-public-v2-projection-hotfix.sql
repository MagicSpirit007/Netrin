-- 09: keep routes_public_v2 readable without granting anon/authenticated access
-- to the internal composite-row helper or route base tables.
-- Production apply (self-hosted):
--   docker exec -i supabase-db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/09-route-public-v2-projection-hotfix.sql

begin;

create or replace view public.routes_public_v2
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
      ) order by p.sort_order
    )
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.moderation_status = 'approved'
  and r.deleted_at is null;

revoke all on public.routes_public_v2 from public, anon, authenticated;
grant select on public.routes_public_v2 to anon, authenticated;

-- This helper stays private. get_route_detail_v1 is SECURITY DEFINER and may
-- use it, but browser roles must not call it or gain route table privileges.
revoke all on function public.netrin_point_public_json(public.route_points)
  from public, anon, authenticated;

comment on view public.routes_public_v2 is
  'Legacy public route projection. Point/media JSON is inlined so browser roles need no helper or base-table privileges.';

notify pgrst, 'reload schema';

commit;
