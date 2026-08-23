# Appearance v3 release template

This runbook describes release gates for an appearance-compatible Netrin
build. It contains no host identity, credential, fixed server path, or deployed
release record.

## Build and verify

From a clean checkout using Node.js 22.19.0 or newer:

```text
npm ci
npm run validate:cell
npm run licenses:check
npm run lint
npm run typecheck
npm test
npm run shell:check
npm run validate:appearance
npm run build
npm run test:smoke
```

Verify the produced `dist/` independently, retain its SHA-256 manifest, and
scan it for secrets and non-public host details. The build directory itself is
not committed.

## Generic deployment contract

- Supply the SSH target, release root, active symlink, health URL, and
  credentials at runtime through the operator's protected environment.
- Upload into a new immutable staging directory and verify every hash before
  activation.
- Resolve and validate all target paths before any privileged move.
- Activate with a same-filesystem atomic symlink switch.
- Validate the web-server configuration, reload only after validation, and
  probe the configured HTTPS route and PWA assets.
- On failure, restore the previous symlink and verify the rollback.
- Never copy `.env.local`, `SERVER.md`, private keys, logs, or build caches.

Appearance Function deployment is a separate server mutation. Back up the
current Function source, deploy only the reviewed package, restart only the
required service, run authenticated and unauthenticated probes, and roll back
on failure.

The repository intentionally does not ship a host-specific activation script.
Operators should adapt this contract to their own infrastructure and approval
process.
