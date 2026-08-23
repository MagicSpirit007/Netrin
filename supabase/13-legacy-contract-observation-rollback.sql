begin;
drop function if exists public.admin_mark_pwa_update_cycle_v1(text);
drop function if exists public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb);
drop function if exists public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb);
alter function public.netrin_submit_route_v3_compat_impl(uuid,jsonb,jsonb,text,jsonb) rename to submit_route_v3;
grant execute on function public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb) to authenticated;
create function public.publish_route_v2(p_route_id uuid,p_title jsonb,p_description jsonb,p_author text,p_points jsonb)
returns uuid language sql security invoker set search_path=''
as $$ select public.submit_route_v3(p_route_id,p_title,p_description,p_author,p_points) $$;
grant execute on function public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb) to authenticated;
drop function if exists public.netrin_record_legacy_contract(text);
drop table if exists public.legacy_contract_usage;
drop table if exists public.legacy_contract_observation;
commit;
notify pgrst,'reload schema';
