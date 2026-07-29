# Security exceptions

## SEC-2026-001

- Advisory: `CVE-2026-45829` (`PYSEC-2026-311` in pip-audit)
- Component: embedded ChromaDB inherited from Bunnyland Server
- Owner: Bunnyland release operator
- Approved: 2026-07-29
- Expires: 2026-08-28
- Review cadence: every 7 days
- Status: temporary launch exception

The integrated server image inherits the narrowly scoped Bunnyland Server exception. It
runs ChromaDB only through the embedded clients, exposes no Chroma HTTP server, does not
enable `trust_remote_code`, and accepts collection selection only from ECS memory profiles
created by Bunnyland.

Every weekly review must update `last_reviewed_at` in `.scanner-exceptions.yaml`, confirm
the matching `.grype.yaml` rule and the upstream server guards still pass, check for an
upstream fix, and record the result in the release validation log. CI rejects an expired or
overdue exception. It may not be renewed without a new explicit acceptance.
