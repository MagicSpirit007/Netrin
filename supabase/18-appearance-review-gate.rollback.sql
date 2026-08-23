-- Permission/function rollback only. Persisted audit_report data is intentionally retained.
revoke all on function public.finalize_appearance_review_v3(uuid, text, text, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
drop function if exists public.finalize_appearance_review_v3(uuid, text, text, text, text, uuid, jsonb, jsonb);

revoke all on function public.review_appearance(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_appearance(uuid, text, text, text, text)
  to authenticated;
