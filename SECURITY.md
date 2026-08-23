# Security policy

## Supported version

Security fixes target the latest published Netrin release and the current
`main` branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting form for this repository:

https://github.com/MagicSpirit007/Netrin/security/advisories/new

Include affected versions, reproduction steps, impact, and any suggested
mitigation. Please avoid accessing data that is not yours, disrupting a live
service, social engineering, denial-of-service testing, or publishing details
before a coordinated fix is available.

The maintainers will acknowledge a complete report as soon as practical,
validate its scope, and coordinate remediation and disclosure. No bounty or
specific response deadline is promised.

## Secrets

Only public browser keys may use the `VITE_` prefix. Supabase service-role
keys, database credentials, model API keys, private keys, and deployment
credentials must remain in server-side secret storage and must never be
committed.
