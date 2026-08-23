-- Read-only structural verification for 07.
begin transaction read only;

do $$
declare
  definition text;
  protected_routine regprocedure;
begin
  select pg_get_functiondef('public.netrin_is_admin(uuid)'::regprocedure) into definition;
  if position('phone_confirmed_at is not null' in lower(definition)) = 0 then
    raise exception 'netrin_is_admin does not require phone_confirmed_at';
  end if;
  if has_function_privilege('anon', 'public.netrin_is_admin(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute netrin_is_admin';
  end if;
  if not has_function_privilege('authenticated', 'public.netrin_is_admin(uuid)', 'EXECUTE') then
    raise exception 'authenticated must execute netrin_is_admin';
  end if;

  select pg_get_functiondef('public.netrin_can_submit()'::regprocedure) into definition;
  if position('phone_confirmed_at is not null' in lower(definition)) = 0 then
    raise exception 'netrin_can_submit does not require phone_confirmed_at';
  end if;
  if has_function_privilege('anon', 'public.netrin_can_submit()', 'EXECUTE') then
    raise exception 'anon must not execute netrin_can_submit';
  end if;
  if not has_function_privilege('authenticated', 'public.netrin_can_submit()', 'EXECUTE') then
    raise exception 'authenticated must execute netrin_can_submit';
  end if;

  foreach protected_routine in array array[
    'public.review_route(uuid,text,text)'::regprocedure,
    'public.admin_save_route(uuid,jsonb,jsonb,text,jsonb,text)'::regprocedure,
    'public.admin_delete_route(uuid,text)'::regprocedure,
    'public.review_appearance(uuid,text,text,text,text)'::regprocedure,
    'public.admin_delete_appearance(uuid,text)'::regprocedure,
    'public.admin_prepare_delete_user(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(protected_routine) into definition;
    if position('netrin_is_admin' in lower(definition)) = 0 then
      raise exception '% does not use netrin_is_admin', protected_routine;
    end if;
  end loop;
end;
$$;

select '07 phone-confirmed submission and admin gates verified' as result;
rollback;
