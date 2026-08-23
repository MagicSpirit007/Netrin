-- Require a confirmed phone number for every server-side submission and admin path.
-- Run manually after deploying phone Auth and the Send SMS Hook:
-- docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < 07-phone-confirmed-submission-gate.sql

begin;

create or replace function public.netrin_is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    join auth.users u on u.id = ur.user_id
    where ur.user_id = p_user_id
      and ur.role = 'admin'
      and p.account_status = 'active'
      and u.phone_confirmed_at is not null
  );
$$;

create or replace function public.netrin_can_submit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.phone_confirmed_at is not null
    )
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.account_status = 'active'
    );
$$;

revoke all on function public.netrin_is_admin(uuid) from public, anon, authenticated;
grant execute on function public.netrin_is_admin(uuid) to authenticated;
revoke all on function public.netrin_can_submit() from public, anon, authenticated;
grant execute on function public.netrin_can_submit() to authenticated;

comment on function public.netrin_is_admin(uuid) is
  'True only for active administrators whose Supabase phone number is confirmed.';

comment on function public.netrin_can_submit() is
  'True only for active, non-anonymous users whose Supabase phone number is confirmed.';

commit;
