-- Netrin second-page migration: routes_public view + publish_route RPC.
--
-- Bridges the hand-made public.routes table to the frontend contract:
--   - src/data/community.ts reads .from('routes_public') and calls .rpc('publish_route', ...)
--   - src/data/types.ts RoutePublicRow defines the exact columns this view must return.
--
-- 2026-06-23: the flower/tree/community "theme" classification was dropped product-wide.
-- This migration removes the routes.theme column (its check constraint + index drop with it),
-- rebuilds the view without theme, and replaces publish_route with a 7-arg signature (no p_theme).
-- PostGIS lives in schema public on this server, so PostGIS calls are qualified public.*.
--
-- Copy this file to the self-hosted Supabase server, then run it manually:
--   docker exec -i supabase-db psql -U postgres -d postgres < 02-routes-public-view-and-publish.sql
--
-- This migration is idempotent. The AI CLI must not execute it over SSH.

begin;

-- 1) Drop the theme classification entirely. The view depends on the column, so drop it first;
--    dropping the column also drops routes_theme_check + routes_theme_idx automatically.
drop view if exists public.routes_public;
alter table public.routes drop column if exists theme;

-- 2) Public read projection. security_invoker = on → the querying role's RLS on
--    public.routes applies, so anon/authenticated only see is_public rows. The explicit
--    where is_public is defense-in-depth and self-documents intent. geom is emitted as
--    GeoJSON so the client never touches WKB.
create view public.routes_public
with (security_invoker = on) as
select
  r.id,
  r.author,
  r.title,
  r.description,
  r.season,
  r.difficulty,
  r.distance,
  r.duration,
  r.tags,
  r.stops,
  r.is_official,
  r.downloads,
  r.likes,
  r.created_at,
  public.st_asgeojson(r.geom)::jsonb as geojson
from public.routes as r
where r.is_public = true;

-- security_invoker views require the caller to hold privileges on the base table;
-- these grants are normally set by Supabase defaults but are repeated here idempotently.
grant select on public.routes to anon, authenticated;
grant select on public.routes_public to anon, authenticated;

-- 3) Publish a community route in one round-trip. Runs as the caller (security invoker),
--    so the routes_insert_own RLS policy (auth.uid() = created_by) is enforced.
--    The pre-theme 8-arg signature is dropped first so this is a clean replace.
drop function if exists public.publish_route(jsonb, jsonb, text, text, text, text, jsonb, jsonb);

create or replace function public.publish_route(
  p_title jsonb,
  p_description jsonb,
  p_distance text,
  p_duration text,
  p_author text,
  p_waypoints jsonb,
  p_stops jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_waypoints is null or jsonb_array_length(p_waypoints) < 2 then
    raise exception 'route needs at least 2 waypoints';
  end if;

  insert into public.routes (
    created_by,
    author,
    title,
    description,
    distance,
    duration,
    stops,
    geom,
    is_official,
    is_public
  )
  values (
    v_uid,
    coalesce(p_author, ''),
    coalesce(p_title, '{}'::jsonb),
    coalesce(p_description, '{}'::jsonb),
    coalesce(p_distance, ''),
    coalesce(p_duration, ''),
    coalesce(p_stops, '[]'::jsonb),
    public.st_setsrid(
      public.st_geomfromgeojson(
        jsonb_build_object('type', 'LineString', 'coordinates', p_waypoints)::text
      ),
      4326
    ),
    false,
    true
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.publish_route(
  jsonb, jsonb, text, text, text, jsonb, jsonb
) from public;
grant execute on function public.publish_route(
  jsonb, jsonb, text, text, text, jsonb, jsonb
) to authenticated;

commit;

notify pgrst, 'reload schema';
