-- Contract rollback only. Route conclusions already applied remain intact and auditable.
begin;
drop function if exists public.admin_confirm_route_geometry_v1(uuid, boolean, text, text, jsonb, jsonb, text);
drop function if exists public.get_my_account_v1();
commit;
notify pgrst, 'reload schema';
