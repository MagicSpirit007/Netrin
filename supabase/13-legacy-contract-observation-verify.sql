do $$ declare d text; begin
  if to_regclass('public.legacy_contract_observation') is null or to_regclass('public.legacy_contract_usage') is null then raise exception 'observation tables missing'; end if;
  if to_regprocedure('public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)') is null
    or to_regprocedure('public.publish_route_v2(uuid,jsonb,jsonb,text,jsonb)') is null
    or to_regprocedure('public.netrin_submit_route_v3_compat_impl(uuid,jsonb,jsonb,text,jsonb)') is null then raise exception 'compat wrappers missing'; end if;
  select pg_get_functiondef('public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)'::regprocedure) into d;
  if position('netrin_record_legacy_contract' in d)=0 or position('set search_path' in lower(d))=0 then raise exception 'submit observation wrapper invalid'; end if;
  if has_table_privilege('anon','public.legacy_contract_usage','select') or has_table_privilege('authenticated','public.legacy_contract_usage','select') then raise exception 'usage table leaked'; end if;
  if has_function_privilege('anon','public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)','execute')
    or not has_function_privilege('authenticated','public.submit_route_v3(uuid,jsonb,jsonb,text,jsonb)','execute') then raise exception 'legacy submit grants invalid'; end if;
end $$;
select started_at,pwa_cycle_marked_at,pwa_cycle_note from public.legacy_contract_observation;
select contract_name,first_called_at,last_called_at,call_count from public.legacy_contract_usage order by contract_name;
