-- Emergency behavioral rollback for 17-security-advisor-read-models.sql.
--
-- Restores the prior definer-view architecture without granting browser roles
-- access to business base tables. This intentionally reintroduces the six
-- Security Advisor findings and should only be used to recover compatibility.
\set ON_ERROR_STOP on

begin;

drop view if exists public.routes_public_v2;
drop view if exists public.routes_owned_v1;
drop view if exists public.routes_owned_v2;
drop view if exists public.routes_admin_v1;
drop view if exists public.appearance_catalog_public;
drop view if exists public.appearance_submissions_private_v1;

drop trigger if exists netrin_projection_routes_queue on public.routes;
drop trigger if exists netrin_projection_route_points_queue on public.route_points;
drop trigger if exists netrin_projection_route_media_queue
  on public.route_point_media;
drop trigger if exists netrin_projection_appearance_queue
  on public.appearance_submissions;

-- Drop only objects owned by SQL17. The final non-CASCADE schema drop will fail
-- and roll the transaction back if another feature has since added private
-- objects, rather than deleting unrelated data.
drop table if exists netrin_private.projection_refresh_queue;
drop table if exists
  netrin_private.routes_public_v2_rm,
  netrin_private.routes_owned_v1_rm,
  netrin_private.routes_owned_v2_rm,
  netrin_private.routes_admin_v1_rm,
  netrin_private.appearance_catalog_public_rm,
  netrin_private.appearance_submissions_private_v1_rm;

drop function if exists
  netrin_private.process_projection_refresh_trigger(),
  netrin_private.queue_route_refresh_trigger(),
  netrin_private.queue_route_point_refresh_trigger(),
  netrin_private.queue_route_media_refresh_trigger(),
  netrin_private.queue_appearance_refresh_trigger(),
  netrin_private.enqueue_projection_refresh(text, uuid),
  netrin_private.refresh_route_current_read_models(uuid),
  netrin_private.refresh_route_legacy_read_models(uuid),
  netrin_private.refresh_appearance_read_models(uuid);

drop schema if exists netrin_private;

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
        'highlightTitle', nullif(coalesce(
          nullif(p.highlight_title, ''),
          nullif(p.species_name, ''),
          nullif(p.title, '')
        ), ''),
        'speciesName', nullif(coalesce(
          nullif(p.species_name, ''),
          p.highlight_title
        ), ''),
        'category', p.category,
        'media', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'order', m.sort_order,
              'mimeType', m.mime_type,
              'width', m.width,
              'height', m.height
            )
            order by m.sort_order
          )
          from public.route_point_media m
          where m.point_id = p.id
        ), '[]'::jsonb)
      )
      order by p.sort_order
    )
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.moderation_status = 'approved'
  and r.deleted_at is null;

create view public.routes_owned_v1
with (security_invoker = off) as
select
  id,
  title,
  description,
  moderation_status,
  rejection_reason,
  created_at,
  updated_at
from public.routes
where created_by = auth.uid();

create view public.routes_owned_v2
with (security_invoker = off) as
select
  r.id,
  r.title,
  r.description,
  r.moderation_status,
  r.rejection_reason,
  r.created_at,
  r.updated_at,
  r.travel_mode,
  r.city_adcode,
  r.city_name,
  r.geometry_source,
  r.distance_m,
  r.duration_s,
  r.metrics_updated_at,
  r.difficulty,
  r.is_loop,
  r.tags,
  r.cover_media_id,
  r.needs_geometry_review,
  case
    when r.line_geom is null then null
    else public.st_asgeojson(r.line_geom)::jsonb
  end as geometry,
  public.netrin_route_bbox_json(
    r.bbox_min_lng,
    r.bbox_min_lat,
    r.bbox_max_lng,
    r.bbox_max_lat
  ) as bbox,
  coalesce((
    select jsonb_agg(
      public.netrin_point_admin_json(p)
      order by p.sort_order
    )
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where r.created_by = auth.uid();

create view public.routes_admin_v1
with (security_invoker = off) as
select
  r.id,
  r.created_by,
  r.author,
  r.title,
  r.description,
  r.moderation_status,
  r.rejection_reason,
  r.created_at,
  r.updated_at,
  r.reviewed_at,
  r.reviewed_by,
  r.travel_mode,
  r.city_adcode,
  r.city_name,
  r.geometry_source,
  r.distance_m,
  r.duration_s,
  r.metrics_updated_at,
  r.difficulty,
  r.is_loop,
  r.tags,
  r.cover_media_id,
  r.needs_geometry_review,
  case
    when r.line_geom is null then null
    else public.st_asgeojson(r.line_geom)::jsonb
  end as geometry,
  public.netrin_route_bbox_json(
    r.bbox_min_lng,
    r.bbox_min_lat,
    r.bbox_max_lng,
    r.bbox_max_lat
  ) as bbox,
  coalesce((
    select jsonb_agg(
      public.netrin_point_admin_json(p)
      order by p.sort_order
    )
    from public.route_points p
    where p.route_id = r.id
  ), '[]'::jsonb) as points
from public.routes r
where public.netrin_is_admin();

create view public.appearance_catalog_public
with (security_invoker = off) as
select
  id,
  package_id,
  package_version,
  display_name,
  summary,
  declared_author,
  license,
  package_sha256,
  byte_size,
  reviewed_at,
  updated_at
from public.appearance_submissions
where moderation_status = 'approved';

create view public.appearance_submissions_private_v1
with (security_invoker = off) as
select
  id,
  owner_id,
  package_id,
  package_version,
  display_name,
  summary,
  declared_author,
  license,
  package_sha256,
  byte_size,
  storage_path,
  audit_report,
  moderation_status,
  rejection_reason,
  reviewed_at,
  reviewed_by,
  created_at,
  updated_at
from public.appearance_submissions
where owner_id = auth.uid()
  or public.netrin_is_admin();

revoke all on
  public.routes_public_v2,
  public.routes_owned_v1,
  public.routes_owned_v2,
  public.routes_admin_v1,
  public.appearance_catalog_public,
  public.appearance_submissions_private_v1
from public, anon, authenticated, service_role;

grant select on public.routes_public_v2 to anon, authenticated;
grant select on public.appearance_catalog_public to anon, authenticated;
grant select on public.routes_owned_v1 to authenticated;
grant select on public.routes_owned_v2 to authenticated;
grant select on public.routes_admin_v1 to authenticated;
grant select on public.appearance_submissions_private_v1 to authenticated;

comment on view public.routes_public_v2 is
  'Legacy public route projection restored by the 17 rollback. Browser roles still have no base-table privileges.';
comment on view public.appearance_submissions_private_v1 is
  'Owner/admin appearance projection with an explicit fixed column list.';

commit;

notify pgrst, 'reload schema';
