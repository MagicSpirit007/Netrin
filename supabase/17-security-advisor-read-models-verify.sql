-- Verification for 17-security-advisor-read-models.sql.
-- Includes transactional trigger checks; all test writes are rolled back.
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_name text;
  v_columns text;
begin
  foreach v_name in array array[
    'routes_public_v2',
    'routes_owned_v1',
    'routes_owned_v2',
    'routes_admin_v1',
    'appearance_catalog_public',
    'appearance_submissions_private_v1'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_name
        and c.relkind = 'v'
        and coalesce(c.reloptions, '{}'::text[])
          @> array['security_invoker=true', 'security_barrier=true']
    ) then
      raise exception 'public.% is not a security-invoker barrier view', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'routes_public_v2_rm',
    'routes_owned_v1_rm',
    'routes_owned_v2_rm',
    'routes_admin_v1_rm',
    'appearance_catalog_public_rm',
    'appearance_submissions_private_v1_rm',
    'projection_refresh_queue'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'netrin_private'
        and c.relname = v_name
        and c.relkind = 'r'
        and c.relrowsecurity
    ) then
      raise exception 'netrin_private.% is missing RLS', v_name;
    end if;
  end loop;

  if has_schema_privilege('anon', 'netrin_private', 'usage')
    or has_schema_privilege('authenticated', 'netrin_private', 'usage')
    or has_schema_privilege('service_role', 'netrin_private', 'usage') then
    raise exception 'an API role has direct netrin_private schema usage';
  end if;

  if has_table_privilege('anon', 'public.routes', 'select')
    or has_table_privilege('anon', 'public.route_points', 'select')
    or has_table_privilege('anon', 'public.route_point_media', 'select')
    or has_table_privilege('anon', 'public.appearance_submissions', 'select')
    or has_table_privilege('authenticated', 'public.routes', 'select')
    or has_table_privilege('authenticated', 'public.route_points', 'select')
    or has_table_privilege('authenticated', 'public.route_point_media', 'select')
    or has_table_privilege('authenticated', 'public.appearance_submissions', 'select') then
    raise exception 'a browser role can read a business base table';
  end if;

  if not has_table_privilege('anon', 'public.routes_public_v2', 'select')
    or not has_table_privilege('authenticated', 'public.routes_public_v2', 'select')
    or not has_table_privilege('anon', 'public.appearance_catalog_public', 'select')
    or not has_table_privilege('authenticated', 'public.appearance_catalog_public', 'select')
    or has_table_privilege('anon', 'public.routes_owned_v1', 'select')
    or has_table_privilege('anon', 'public.routes_owned_v2', 'select')
    or has_table_privilege('anon', 'public.routes_admin_v1', 'select')
    or has_table_privilege(
      'anon',
      'public.appearance_submissions_private_v1',
      'select'
    )
    or not has_table_privilege('authenticated', 'public.routes_owned_v1', 'select')
    or not has_table_privilege('authenticated', 'public.routes_owned_v2', 'select')
    or not has_table_privilege('authenticated', 'public.routes_admin_v1', 'select')
    or not has_table_privilege(
      'authenticated',
      'public.appearance_submissions_private_v1',
      'select'
    ) then
    raise exception 'public read-model view grants drifted';
  end if;

  if not has_table_privilege(
      'anon',
      'netrin_private.routes_public_v2_rm',
      'select'
    )
    or not has_table_privilege(
      'authenticated',
      'netrin_private.routes_owned_v2_rm',
      'select'
    )
    or has_table_privilege(
      'anon',
      'netrin_private.routes_owned_v2_rm',
      'select'
    ) then
    raise exception 'private read-model table grants drifted';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'netrin_private'
      and p.prosecdef
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute')
      )
  ) then
    raise exception 'an API role can execute a netrin_private definer function';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'netrin_private'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) config
        where split_part(config, '=', 1) = 'search_path'
          and split_part(config, '=', 2) in ('', '""')
      )
  ) then
    raise exception 'a netrin_private definer function has a mutable search_path';
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'routes_public_v2';
  if v_columns <> 'id,author,title,description,downloads,likes,created_at,points' then
    raise exception 'routes_public_v2 columns drifted: %', v_columns;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'routes_owned_v1';
  if v_columns <> 'id,title,description,moderation_status,rejection_reason,created_at,updated_at' then
    raise exception 'routes_owned_v1 columns drifted: %', v_columns;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'routes_owned_v2';
  if v_columns <> 'id,title,description,moderation_status,rejection_reason,created_at,updated_at,travel_mode,city_adcode,city_name,geometry_source,distance_m,duration_s,metrics_updated_at,difficulty,is_loop,tags,cover_media_id,needs_geometry_review,geometry,bbox,points' then
    raise exception 'routes_owned_v2 columns drifted: %', v_columns;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'routes_admin_v1';
  if v_columns <> 'id,created_by,author,title,description,moderation_status,rejection_reason,created_at,updated_at,reviewed_at,reviewed_by,travel_mode,city_adcode,city_name,geometry_source,distance_m,duration_s,metrics_updated_at,difficulty,is_loop,tags,cover_media_id,needs_geometry_review,geometry,bbox,points' then
    raise exception 'routes_admin_v1 columns drifted: %', v_columns;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'appearance_catalog_public';
  if v_columns <> 'id,package_id,package_version,display_name,summary,declared_author,license,package_sha256,byte_size,reviewed_at,updated_at' then
    raise exception 'appearance_catalog_public columns drifted: %', v_columns;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'appearance_submissions_private_v1';
  if v_columns <> 'id,owner_id,package_id,package_version,display_name,summary,declared_author,license,package_sha256,byte_size,storage_path,audit_report,moderation_status,rejection_reason,reviewed_at,reviewed_by,created_at,updated_at' then
    raise exception 'appearance_submissions_private_v1 columns drifted: %',
      v_columns;
  end if;
end;
$$;

do $$
declare
  v_expected bigint;
  v_actual bigint;
  v_expected_points bigint;
  v_actual_points bigint;
begin
  select count(*) into v_expected from public.routes;

  select count(*) into v_actual from netrin_private.routes_owned_v1_rm;
  if v_actual <> v_expected then
    raise exception 'owned v1 read model count %, expected %', v_actual, v_expected;
  end if;
  select count(*) into v_actual from netrin_private.routes_owned_v2_rm;
  if v_actual <> v_expected then
    raise exception 'owned v2 read model count %, expected %', v_actual, v_expected;
  end if;
  select count(*) into v_actual from netrin_private.routes_admin_v1_rm;
  if v_actual <> v_expected then
    raise exception 'admin read model count %, expected %', v_actual, v_expected;
  end if;

  if exists (
    select 1
    from netrin_private.routes_owned_v2_rm m
    join public.routes r on r.id = m.id
    where m.owner_id is distinct from r.created_by
      or m.title is distinct from r.title
      or m.description is distinct from r.description
      or m.moderation_status is distinct from r.moderation_status
      or m.rejection_reason is distinct from r.rejection_reason
      or m.travel_mode is distinct from r.travel_mode
      or m.needs_geometry_review is distinct from r.needs_geometry_review
  ) then
    raise exception 'owned v2 read model scalar data drifted';
  end if;

  if exists (
    select 1
    from netrin_private.routes_admin_v1_rm m
    join public.routes r on r.id = m.id
    where m.created_by is distinct from r.created_by
      or m.title is distinct from r.title
      or m.moderation_status is distinct from r.moderation_status
      or m.reviewed_by is distinct from r.reviewed_by
  ) then
    raise exception 'admin route read model scalar data drifted';
  end if;

  select count(*) into v_expected
  from public.routes
  where moderation_status = 'approved' and deleted_at is null;
  select count(*) into v_actual from netrin_private.routes_public_v2_rm;
  if v_actual <> v_expected then
    raise exception 'public route read model count %, expected %', v_actual, v_expected;
  end if;

  select count(*) into v_expected_points
  from public.route_points p
  join public.routes r on r.id = p.route_id
  where r.moderation_status = 'approved' and r.deleted_at is null;
  select coalesce(sum(jsonb_array_length(points)), 0)
  into v_actual_points
  from netrin_private.routes_public_v2_rm;
  if v_actual_points <> v_expected_points then
    raise exception 'public point count %, expected %',
      v_actual_points, v_expected_points;
  end if;

  if exists (
    select 1
    from public.routes_public_v2 r
    cross join lateral jsonb_array_elements(r.points) p
    where p ?| array[
      'storagePath',
      'storage_path',
      'createdBy',
      'created_by',
      'moderationStatus',
      'rejectionReason',
      'auditReport',
      'audit_report'
    ]
      or exists (
        select 1
        from jsonb_array_elements(coalesce(p -> 'media', '[]'::jsonb)) m
        where m ?| array['storagePath', 'storage_path', 'url']
      )
  ) then
    raise exception 'public route API leaks protected fields';
  end if;

  select count(*) into v_expected from public.appearance_submissions;
  select count(*) into v_actual
  from netrin_private.appearance_submissions_private_v1_rm;
  if v_actual <> v_expected then
    raise exception 'private appearance count %, expected %', v_actual, v_expected;
  end if;

  select count(*) into v_expected
  from public.appearance_submissions
  where moderation_status = 'approved';
  select count(*) into v_actual
  from netrin_private.appearance_catalog_public_rm;
  if v_actual <> v_expected then
    raise exception 'appearance catalog count %, expected %', v_actual, v_expected;
  end if;
end;
$$;

-- The central property of this design: callers can use the public invoker views
-- while direct USAGE on the backing schema remains revoked.
set local role anon;
select count(*) as anon_public_routes from public.routes_public_v2;
select count(*) as anon_appearance_catalog from public.appearance_catalog_public;
reset role;

set local role authenticated;
select count(*) as authenticated_public_routes from public.routes_public_v2;
select 1 / case when count(*) = 0 then 1 else 0 end
  as null_jwt_owned_v1_is_empty
from public.routes_owned_v1;
select 1 / case when count(*) = 0 then 1 else 0 end
  as null_jwt_owned_v2_is_empty
from public.routes_owned_v2;
select 1 / case when count(*) = 0 then 1 else 0 end
  as null_jwt_admin_is_empty
from public.routes_admin_v1;
select 1 / case when count(*) = 0 then 1 else 0 end
  as null_jwt_appearance_private_is_empty
from public.appearance_submissions_private_v1;
reset role;

-- Simulate a non-admin route owner when production has one. Expected counts
-- are stored in transaction-local custom settings before privileges are lowered.
select set_config(
  'request.jwt.claim.sub',
  coalesce((
    select r.created_by::text
    from public.routes r
    where r.created_by is not null
      and not public.netrin_is_admin(r.created_by)
    order by r.id
    limit 1
  ), '00000000-0000-0000-0000-000000000000'),
  true
);
select set_config(
  'netrin.verify.expected_owned_routes',
  count(*)::text,
  true
)
from public.routes
where created_by = auth.uid();

set local role authenticated;
select 1 / case
  when count(*) = current_setting(
    'netrin.verify.expected_owned_routes'
  )::bigint then 1
  else 0
end as owner_v1_scope_matches
from public.routes_owned_v1;
select 1 / case
  when count(*) = current_setting(
    'netrin.verify.expected_owned_routes'
  )::bigint then 1
  else 0
end as owner_v2_scope_matches
from public.routes_owned_v2;
select 1 / case when count(*) = 0 then 1 else 0 end
  as non_admin_route_admin_view_is_empty
from public.routes_admin_v1;
reset role;

-- Simulate a non-admin appearance owner independently from route ownership.
select set_config(
  'request.jwt.claim.sub',
  coalesce((
    select a.owner_id::text
    from public.appearance_submissions a
    where a.owner_id is not null
      and not public.netrin_is_admin(a.owner_id)
    order by a.id
    limit 1
  ), '00000000-0000-0000-0000-000000000000'),
  true
);
select set_config(
  'netrin.verify.expected_owned_appearances',
  count(*)::text,
  true
)
from public.appearance_submissions
where owner_id = auth.uid();

set local role authenticated;
select 1 / case
  when count(*) = current_setting(
    'netrin.verify.expected_owned_appearances'
  )::bigint then 1
  else 0
end as appearance_owner_scope_matches
from public.appearance_submissions_private_v1;
select 1 / case when count(*) = 0 then 1 else 0 end
  as non_admin_appearance_admin_view_is_empty
from public.routes_admin_v1;
reset role;

-- Production moderation requires at least one active administrator. Use that
-- real identity to prove both administrator projections traverse the RLS models.
do $$
begin
  if not exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin'
      and p.account_status = 'active'
  ) then
    raise exception 'no active administrator exists for role-matrix verification';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (
    select ur.user_id::text
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin'
      and p.account_status = 'active'
    order by ur.user_id
    limit 1
  ),
  true
);
select set_config(
  'netrin.verify.expected_admin_routes',
  count(*)::text,
  true
) from public.routes;
select set_config(
  'netrin.verify.expected_admin_appearances',
  count(*)::text,
  true
) from public.appearance_submissions;

set local role authenticated;
select 1 / case
  when count(*) = current_setting(
    'netrin.verify.expected_admin_routes'
  )::bigint then 1
  else 0
end as admin_route_scope_matches
from public.routes_admin_v1;
select 1 / case
  when count(*) = current_setting(
    'netrin.verify.expected_admin_appearances'
  )::bigint then 1
  else 0
end as admin_appearance_scope_matches
from public.appearance_submissions_private_v1;
reset role;

select set_config('request.jwt.claim.sub', '', true);

-- Full transactional synchronization exercise. Synthetic source rows are
-- inserted, modified and deleted; the outer transaction rolls every write back.
select set_config(
  'netrin.verify.owner_id',
  (
    select ur.user_id::text
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin'
      and p.account_status = 'active'
    order by ur.user_id
    limit 1
  ),
  true
);
select set_config('netrin.verify.route_id', gen_random_uuid()::text, true);
select set_config('netrin.verify.point_id', gen_random_uuid()::text, true);
select set_config('netrin.verify.media_id', gen_random_uuid()::text, true);
select set_config('netrin.verify.appearance_id', gen_random_uuid()::text, true);

set constraints all deferred;

insert into public.routes (
  id,
  created_by,
  author,
  title,
  description,
  is_official,
  is_public,
  moderation_status,
  travel_mode,
  needs_geometry_review
)
values (
  current_setting('netrin.verify.route_id')::uuid,
  current_setting('netrin.verify.owner_id')::uuid,
  'security-advisor-verify',
  '{"zh-CN":"安全验证路线","en":"Security verification route"}'::jsonb,
  '{"zh-CN":"事务内回滚","en":"Rolled back in transaction"}'::jsonb,
  false,
  false,
  'pending',
  'walking',
  true
);

insert into public.route_points (
  id,
  route_id,
  sort_order,
  location,
  title,
  species_name,
  highlight_title,
  category,
  note
)
values (
  current_setting('netrin.verify.point_id')::uuid,
  current_setting('netrin.verify.route_id')::uuid,
  1,
  public.st_setsrid(public.st_makepoint(116.397, 39.908), 4326),
  'verify-title',
  'verify-species',
  'verify-highlight',
  'tree',
  'verify-note-v1'
);

insert into public.route_point_media (
  id,
  point_id,
  sort_order,
  storage_path,
  mime_type,
  width,
  height
)
values (
  current_setting('netrin.verify.media_id')::uuid,
  current_setting('netrin.verify.point_id')::uuid,
  1,
  'routes/' || current_setting('netrin.verify.owner_id') || '/'
    || current_setting('netrin.verify.route_id') || '/'
    || current_setting('netrin.verify.point_id') || '/verify.jpg',
  'image/jpeg',
  10,
  10
);

set constraints all immediate;

do $$
declare
  v_route_id uuid := current_setting('netrin.verify.route_id')::uuid;
begin
  if not exists (
      select 1 from netrin_private.routes_owned_v1_rm where id = v_route_id
    )
    or not exists (
      select 1 from netrin_private.routes_owned_v2_rm
      where id = v_route_id
        and jsonb_array_length(points) = 1
        and points #>> '{0,media,0,storagePath}' like 'routes/%'
    )
    or not exists (
      select 1 from netrin_private.routes_admin_v1_rm where id = v_route_id
    )
    or exists (
      select 1 from netrin_private.routes_public_v2_rm where id = v_route_id
    ) then
    raise exception 'route/point/media insert did not refresh expected read models';
  end if;
end;
$$;

set constraints all deferred;

update public.routes
set
  moderation_status = 'approved',
  is_public = true,
  title = '{"zh-CN":"安全验证路线已批准","en":"Approved verification route"}'::jsonb,
  updated_at = now()
where id = current_setting('netrin.verify.route_id')::uuid;

update public.route_points
set note = 'verify-note-v2'
where id = current_setting('netrin.verify.point_id')::uuid;

update public.route_point_media
set width = 20
where id = current_setting('netrin.verify.media_id')::uuid;

set constraints all immediate;

do $$
declare
  v_route_id uuid := current_setting('netrin.verify.route_id')::uuid;
begin
  if not exists (
    select 1
    from netrin_private.routes_public_v2_rm
    where id = v_route_id
      and title ->> 'zh-CN' = '安全验证路线已批准'
      and points #>> '{0,text}' = 'verify-note-v2'
      and (points #>> '{0,media,0,width}')::integer = 20
      and not (points #> '{0,media,0}' ? 'storagePath')
  ) then
    raise exception 'route/point/media update did not refresh public read model';
  end if;

  if not exists (
    select 1
    from netrin_private.routes_owned_v2_rm
    where id = v_route_id
      and points #>> '{0,text}' = 'verify-note-v2'
      and (points #>> '{0,media,0,width}')::integer = 20
      and points #>> '{0,media,0,storagePath}' like 'routes/%'
  ) then
    raise exception 'route/point/media update did not refresh owner read model';
  end if;
end;
$$;

set constraints all deferred;

delete from public.route_point_media
where id = current_setting('netrin.verify.media_id')::uuid;

set constraints all immediate;

do $$
begin
  if not exists (
    select 1
    from netrin_private.routes_owned_v2_rm
    where id = current_setting('netrin.verify.route_id')::uuid
      and coalesce(jsonb_array_length(points #> '{0,media}'), -1) = 0
  ) then
    raise exception 'route media delete did not refresh owner read model';
  end if;
end;
$$;

set constraints all deferred;

delete from public.route_points
where id = current_setting('netrin.verify.point_id')::uuid;

set constraints all immediate;

do $$
begin
  if not exists (
    select 1
    from netrin_private.routes_owned_v2_rm
    where id = current_setting('netrin.verify.route_id')::uuid
      and jsonb_array_length(points) = 0
  ) then
    raise exception 'route point delete did not refresh owner read model';
  end if;
end;
$$;

set constraints all deferred;

delete from public.routes
where id = current_setting('netrin.verify.route_id')::uuid;

set constraints all immediate;

do $$
declare
  v_route_id uuid := current_setting('netrin.verify.route_id')::uuid;
begin
  if exists (
      select 1 from netrin_private.routes_public_v2_rm where id = v_route_id
    )
    or exists (
      select 1 from netrin_private.routes_owned_v1_rm where id = v_route_id
    )
    or exists (
      select 1 from netrin_private.routes_owned_v2_rm where id = v_route_id
    )
    or exists (
      select 1 from netrin_private.routes_admin_v1_rm where id = v_route_id
    ) then
    raise exception 'route delete left read-model rows';
  end if;
end;
$$;

set constraints all deferred;

insert into public.appearance_submissions (
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
  moderation_status
)
values (
  current_setting('netrin.verify.appearance_id')::uuid,
  current_setting('netrin.verify.owner_id')::uuid,
  'security-advisor-' || replace(
    current_setting('netrin.verify.appearance_id'),
    '-',
    ''
  ),
  '0.0.0-verify',
  'Security Advisor verify',
  'Rolled back in the verification transaction',
  'Netrin verification',
  'MIT',
  repeat('0', 64),
  1,
  'verify/' || current_setting('netrin.verify.appearance_id') || '.zip',
  '{}'::jsonb,
  'pending'
);

set constraints all immediate;

do $$
declare
  v_id uuid := current_setting('netrin.verify.appearance_id')::uuid;
begin
  if not exists (
      select 1
      from netrin_private.appearance_submissions_private_v1_rm
      where id = v_id
    )
    or exists (
      select 1
      from netrin_private.appearance_catalog_public_rm
      where id = v_id
    ) then
    raise exception 'appearance insert did not refresh expected read models';
  end if;
end;
$$;

set constraints all deferred;

update public.appearance_submissions
set
  moderation_status = 'approved',
  display_name = 'Security Advisor verify approved',
  reviewed_at = now(),
  reviewed_by = current_setting('netrin.verify.owner_id')::uuid,
  updated_at = now()
where id = current_setting('netrin.verify.appearance_id')::uuid;

set constraints all immediate;

do $$
begin
  if not exists (
    select 1
    from netrin_private.appearance_catalog_public_rm
    where id = current_setting('netrin.verify.appearance_id')::uuid
      and display_name = 'Security Advisor verify approved'
  ) then
    raise exception 'appearance update did not refresh public catalog';
  end if;
end;
$$;

set constraints all deferred;

delete from public.appearance_submissions
where id = current_setting('netrin.verify.appearance_id')::uuid;

set constraints all immediate;

do $$
declare
  v_id uuid := current_setting('netrin.verify.appearance_id')::uuid;
begin
  if exists (
      select 1
      from netrin_private.appearance_catalog_public_rm
      where id = v_id
    )
    or exists (
      select 1
      from netrin_private.appearance_submissions_private_v1_rm
      where id = v_id
    ) then
    raise exception 'appearance delete left read-model rows';
  end if;

  if exists (select 1 from netrin_private.projection_refresh_queue) then
    raise exception 'projection refresh queue was not drained';
  end if;
end;
$$;

rollback;
