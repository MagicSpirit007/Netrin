# Deployment templates

This directory contains reusable examples only. It intentionally records no
production hostname, address, credential, fixed filesystem layout, deployment
hash, or migration status.

- `nginx/netrin-supabase.example.conf`: static PWA and self-hosted Supabase
  reverse-proxy boundaries.
- `../services/netrin-ai-orchestrator/ops/`: AI route proxy and egress-control
  examples.
- `../supabase/`: SQL and Edge Function source. Applying any migration is a
  separate operator action.

Replace every `example` value, verify resolved paths, adapt rate limits to the
deployment, and obtain explicit authorization before changing a live system.
