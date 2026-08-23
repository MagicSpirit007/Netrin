-- Behavioral rollback for 09. Restores the 08 helper-based view definition.
-- This also restores the known full-select 401 and is for emergency rollback only.

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
    select jsonb_agg(public.netrin_point_public_json(p) order by p.sort_order)
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.moderation_status = 'approved' and r.deleted_at is null;

revoke all on public.routes_public_v2 from public, anon, authenticated;
grant select on public.routes_public_v2 to anon, authenticated;
revoke all on function public.netrin_point_public_json(public.route_points)
  from public, anon, authenticated;

comment on view public.routes_public_v2 is
  'Legacy 08 helper-based definition restored by emergency rollback.';

notify pgrst, 'reload schema';

commit;
