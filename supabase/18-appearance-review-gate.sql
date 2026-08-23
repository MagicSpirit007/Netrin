-- Netrin appearance v3 administrator review gate.
-- Local candidate only. Do not execute on production without explicit authorization.

create or replace function public.finalize_appearance_review_v3(
  p_submission_id uuid,
  p_decision text,
  p_reason text default null,
  p_display_name text default null,
  p_summary text default null,
  p_reviewer_id uuid default null,
  p_admin_review jsonb default null,
  p_validation_summary jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_reviewed_at timestamptz := clock_timestamp();
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid review decision';
  end if;
  if p_reviewer_id is null or not exists (
    select 1
    from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'admin'
    join auth.users u on u.id = p.id
    where p.id = p_reviewer_id
      and p.account_status = 'active'
      and u.phone_confirmed_at is not null
  ) then
    raise exception 'active confirmed admin required';
  end if;
  if p_decision = 'rejected' and nullif(trim(p_reason), '') is null then
    raise exception 'rejection reason required';
  end if;
  if p_decision = 'approved' and (
    p_admin_review is null
    or jsonb_typeof(p_admin_review) <> 'object'
    or p_validation_summary is null
    or jsonb_typeof(p_validation_summary) <> 'object'
    or coalesce((p_validation_summary ->> 'machineAuditValid')::boolean, false) is not true
    or nullif(trim(p_display_name), '') is null
    or nullif(trim(p_summary), '') is null
  ) then
    raise exception 'validated administrator review and catalog copy required';
  end if;
  if char_length(coalesce(p_reason, '')) > 500
    or char_length(coalesce(p_display_name, '')) > 80
    or char_length(coalesce(p_summary, '')) > 500 then
    raise exception 'appearance review text too long';
  end if;

  select to_jsonb(a) into v_before
  from public.appearance_submissions a
  where a.id = p_submission_id
  for update;
  if v_before is null then raise exception 'appearance not found'; end if;
  if v_before ->> 'moderation_status' <> 'pending' then
    raise exception 'appearance is not pending';
  end if;

  update public.appearance_submissions
  set display_name = case when p_decision = 'approved' then trim(p_display_name) else display_name end,
      summary = case when p_decision = 'approved' then trim(p_summary) else summary end,
      moderation_status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then trim(p_reason) else null end,
      audit_report = case when p_decision = 'approved' then
        jsonb_set(
          coalesce(audit_report, '{}'::jsonb),
          '{adminReview}',
          jsonb_build_object(
            'trust', 'server-validated-admin-review',
            'reviewerId', p_reviewer_id,
            'reviewedAt', v_reviewed_at,
            'report', p_admin_review,
            'validationSummary', p_validation_summary
          ),
          true
        )
      else audit_report end,
      reviewed_at = v_reviewed_at,
      reviewed_by = p_reviewer_id,
      updated_at = v_reviewed_at
  where id = p_submission_id;

  select to_jsonb(a) into v_after
  from public.appearance_submissions a
  where a.id = p_submission_id;

  insert into public.moderation_events(
    actor_id, subject_type, subject_id, action, before_state, after_state, note
  ) values (
    p_reviewer_id, 'appearance', p_submission_id::text, p_decision,
    v_before, v_after, nullif(trim(p_reason), '')
  );
end;
$$;

revoke all on function public.review_appearance(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_appearance(uuid, text, text, text, text)
  to service_role;

revoke all on function public.finalize_appearance_review_v3(uuid, text, text, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_appearance_review_v3(uuid, text, text, text, text, uuid, jsonb, jsonb)
  to service_role;

comment on function public.finalize_appearance_review_v3(uuid, text, text, text, text, uuid, jsonb, jsonb) is
  'Service-only finalizer. netrin-appearance must first re-audit private package bytes and validate the administrator v3 report.';
