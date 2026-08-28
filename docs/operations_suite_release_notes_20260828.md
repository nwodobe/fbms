# Review notes — Operations Suite MVP

## What reviewers should verify first

1. Root portal exposes exactly the five business workspaces plus Traceability 360 and Reports & Export.
2. Existing stable routes still open from the workspaces.
3. Authentication gate is loaded on every new workspace.
4. 2027 parcel/GPS remains non-blocking.
5. LBA direct Factory routing is visible and does not force Stock Transfer.
6. Warehouse UI preserves LOT identity vs BIN location semantics.
7. Factory UI separates Factory Warehouse from Processing.
8. Cross-domain Traceability search returns only data allowed by existing RLS/security-invoker views.
9. Consolidated XLSX is values-only and contains Metadata.
10. No sample financing, purchase, delivery, transfer or bag-request transactions were inserted into production.

## Database review

Applied migration names are listed in `docs/operations_suite_mvp_implementation_20260828.md`. The production migration is additive and keeps existing RCN / Field Buying engines. New tables use RLS; critical bag release uses a server-side RPC with authorization, remaining-authorization checks, stock checks, advisory locking and idempotency.

## Human sign-off required

This change touches `index.html`, new application `.html` and JavaScript, and production Supabase schema. Repository policy classifies those paths as human-review changes. Do not auto-merge.
