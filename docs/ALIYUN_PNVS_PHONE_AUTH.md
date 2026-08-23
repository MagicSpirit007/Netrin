# Aliyun PNVS phone authentication template

Netrin's optional phone-login flow uses a Supabase Send SMS Hook backed by an
Aliyun PNVS adapter. This document is a reusable configuration template, not a
record of any deployed host.

## Trust boundary

- The browser sends a phone number to Supabase Auth and never receives an
  Aliyun AccessKey.
- Supabase signs the Send SMS Hook request.
- The Edge Function verifies that signature, validates the payload, and calls
  the configured PNVS template.
- Aliyun credentials, template identifiers, signing secrets, and service-role
  credentials live only in server-side secret storage.
- A confirmed phone is required for route submission, moderation, and the
  route-planning proxy. Phone confirmation is not proof of real-world identity.

## Required server-side values

Use deployment-specific names that match the Edge Function source. At minimum
the operator must provide:

```text
ALIYUN_ACCESS_KEY_ID=<secret>
ALIYUN_ACCESS_KEY_SECRET=<secret>
ALIYUN_PNVS_SIGN_NAME=<configured sign>
ALIYUN_PNVS_TEMPLATE_CODE=<configured template>
SEND_SMS_HOOK_SECRET=<secret>
```

Do not prefix any of these with `VITE_`. Do not put them in `.env.local`, a
Compose file, a shell history, screenshots, issue text, or this repository.

## Deployment checklist

1. Confirm the target Supabase project and back up the current Auth/Function
   configuration using the operator's own protected process.
2. Set secrets through the platform secret store.
3. Deploy only the reviewed hook Function.
4. Configure the Supabase Send SMS Hook URL and signing secret.
5. Test invalid signatures, malformed payloads, provider errors, resend limits,
   and a real confirmation flow with a dedicated test account.
6. Confirm logs mask phone numbers and never print secrets or full provider
   responses.
7. Verify rollback by restoring the previous hook configuration without
   deleting user records.

Production deployment, credential rotation, database changes, and live SMS
tests require separate operator authorization. Nothing in the local build or
CI applies this template automatically.
