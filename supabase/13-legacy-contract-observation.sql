-- Netrin R1->M7 compatibility observation. Apply with R1 before activating the new PWA.
-- Local migration only; the AI does not run this on the production server.
begin;

create table if not exists public.legacy_contract_observation (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now(),
  pwa_cycle_marked_at timestamptz,
  pwa_cycle_note text not null default '' check (char_length(pwa_cycle_note) <= 500)
);
insert into public.legacy_contract_observation(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.legacy_contract_usage (
  contract_name text primary key check (contract_name in ('submit_route_v3','publish_route_v2')),
  first_called_at timestamptz not null,
  last_called_at timestamptz not null,
  call_count bigint not null default 1 check (call_count > 0)
);

revoke all on public.legacy_contract_observation, public.legacy_contract_usage from public,anon,authenticated;
alter table public.legacy_contract_observation enable row level security;
alter table public.legacy_contract_usage enable row level security;

create or replace function public.netrin_record_legacy_contract(p_contract text)
returns void language plpgsql security definer set search_path=''
as $$ begin
  if p_contract not in ('submit_route_v3','publish_route_v2') then raise exception 'invalid legacy contract'; end if;
  insert into public.legacy_contract_usage(contract_name,first_called_at,last_called_at,call_count)
  values(p_contract,now(),now(),1)
  on conflict(contract_name) do update set last_called_at=excluded.last_called_at,call_count=public.legacy_contract_usage.call_count+1;
end $$;
revoke all on function public.netrin_record_legacy_contract(text) from public,anon,authenticated;

do $$ begin
  if to_regprocedure('public.netrin_submit_route_v3_compat_impl(uuid,jsonb,jsonb,text,jsonb)') is null then
    if to_regprocedure('public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)') is null then raise exception 'submit_route_v3 missing'; end if;
    alter function public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb) rename to netrin_submit_route_v3_compat_impl;
  end if;
end $$;

create or replace function public.submit_route_v3(p_route_id uuid,p_title jsonb,p_description jsonb,p_author text,p_points jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$ declare v_id uuid; begin
  v_id:=public.netrin_submit_route_v3_compat_impl(p_route_id,p_title,p_description,p_author,p_points);
  perform public.netrin_record_legacy_contract('submit_route_v3');
  return v_id;
end $$;
revoke all on function public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb) to authenticated;

create or replace function public.publish_route_v2(p_route_id uuid,p_title jsonb,p_description jsonb,p_author text,p_points jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$ declare v_id uuid; begin
  v_id:=public.netrin_submit_route_v3_compat_impl(p_route_id,p_title,p_description,p_author,p_points);
  perform public.netrin_record_legacy_contract('publish_route_v2');
  return v_id;
end $$;
revoke all on function public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb) to authenticated;

create or replace function public.admin_mark_pwa_update_cycle_v1(p_note text)
returns timestamptz language plpgsql security definer set search_path=''
as $$ declare v_at timestamptz; begin
  if not public.netrin_is_admin() then raise exception 'admin required'; end if;
  p_note:=trim(coalesce(p_note,''));
  if char_length(p_note) not between 1 and 500 then raise exception 'PWA cycle note required'; end if;
  update public.legacy_contract_observation set pwa_cycle_marked_at=now(),pwa_cycle_note=p_note where singleton returning pwa_cycle_marked_at into v_at;
  insert into public.moderation_events(actor_id,subject_type,subject_id,action,note)
  values(auth.uid(),'account','legacy-contracts','pwa-update-cycle-observed',p_note);
  return v_at;
end $$;
revoke all on function public.admin_mark_pwa_update_cycle_v1(text) from public,anon,authenticated;
grant execute on function public.admin_mark_pwa_update_cycle_v1(text) to authenticated;

commit;
notify pgrst,'reload schema';
