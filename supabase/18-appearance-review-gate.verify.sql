-- Run after 18-appearance-review-gate.sql. All rows must return the expected booleans.
select
  has_function_privilege('anon', 'public.review_appearance(uuid,text,text,text,text)', 'execute') as anon_legacy_execute,
  has_function_privilege('authenticated', 'public.review_appearance(uuid,text,text,text,text)', 'execute') as authenticated_legacy_execute,
  has_function_privilege('service_role', 'public.review_appearance(uuid,text,text,text,text)', 'execute') as service_legacy_execute,
  has_function_privilege('anon', 'public.finalize_appearance_review_v3(uuid,text,text,text,text,uuid,jsonb,jsonb)', 'execute') as anon_v3_execute,
  has_function_privilege('authenticated', 'public.finalize_appearance_review_v3(uuid,text,text,text,text,uuid,jsonb,jsonb)', 'execute') as authenticated_v3_execute,
  has_function_privilege('service_role', 'public.finalize_appearance_review_v3(uuid,text,text,text,text,uuid,jsonb,jsonb)', 'execute') as service_v3_execute;

do $$
declare v_source text;
begin
  if has_function_privilege('authenticated', 'public.review_appearance(uuid,text,text,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.finalize_appearance_review_v3(uuid,text,text,text,text,uuid,jsonb,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.finalize_appearance_review_v3(uuid,text,text,text,text,uuid,jsonb,jsonb)', 'execute') then
    raise exception 'appearance review execution privileges are unsafe';
  end if;
  select pg_get_functiondef('public.finalize_appearance_review_v3(uuid,text,text,text,text,uuid,jsonb,jsonb)'::regprocedure)
    into v_source;
  if v_source not like '%server-validated-admin-review%'
    or v_source not like '%machineAuditValid%'
    or v_source not like '%moderation_status%pending%' then
    raise exception 'appearance v3 finalizer invariants are missing';
  end if;
end;
$$;
