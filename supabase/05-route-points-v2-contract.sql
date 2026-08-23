-- 移步换景 / Netrin route storage v2 — contract phase.
--
-- Run only after 04-route-points-v2-expand.sql, the v2 frontend deployment, and
-- route/point/media count verification. This removes legacy route geometry and
-- provider-derived fields; it does not delete routes, route_points, media rows,
-- or Supabase Storage objects.
--
-- Manual command on the self-hosted server:
--   docker exec -i supabase-db psql -U postgres -d postgres < 05-route-points-v2-contract.sql
--
-- The AI CLI must not run this migration over SSH.

begin;

drop view if exists public.routes_public;
drop function if exists public.publish_route(jsonb, jsonb, text, text, text, jsonb, jsonb);

alter table public.routes
  drop column if exists geom,
  drop column if exists stops,
  drop column if exists distance,
  drop column if exists duration,
  drop column if exists season,
  drop column if exists difficulty,
  drop column if exists tags;

commit;
notify pgrst, 'reload schema';
