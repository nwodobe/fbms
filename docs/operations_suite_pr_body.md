# Operations Suite MVP

Implements the validated P0 architecture from the ANAGROCI Operations specification.

## Main changes
- 5-workspace Operations Portal.
- Field Buying, LBA Purchase, Warehouse Operations, Stock Transfer and Factory workspaces.
- Traceability 360 and Reports & Export as cross-module services.
- Canonical Site/Warehouse references in Supabase.
- LBA funding limits/history and Funding Cycle foundations.
- Central Bag Management approvals, AFLP envelope controls, separation of duties and multi-release support.
- Cross-domain traceability projection.
- Autonomous Supabase-driven XLSX output.

## Safety / migration choices
- Stable Field Buying and RCN TRACE engines are reused, not rebuilt.
- No synthetic business transactions were inserted.
- Parcel/GPS remains non-blocking for 2027.
- No unconfirmed Finance formula or aging/tolerance threshold was invented.
- 15,000 AFLP bags remains an example, not production seed data.

## Supabase migrations already applied
- operations_suite_mvp_foundations_20260828
- operations_suite_mvp_indexes_policies_20260828
- operations_suite_bag_accounts_20260828
- operations_suite_workflow_traceability_20260828
- operations_suite_guard_execute_hardening_20260828

## Review gate
This PR modifies the root portal and application HTML/JS. Human review is required by repository policy. Do not auto-merge.
