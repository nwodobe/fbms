# ANAGROCI Operations Suite — Implementation log

Date: 2026-08-28
Branch: `feat/operations-suite-mvp-architecture`

## Objective

Implement the validated P0 architecture without rebuilding stable business engines: five business workspaces, shared Traceability 360, shared reporting, canonical Site/Warehouse references, LBA funding-cycle foundations, and one central bag approval/ledger model.

## GitHub changes

- Root portal reduced to five workspaces:
  - FIELD BUYING
  - LBA PURCHASE
  - WAREHOUSE OPERATIONS
  - STOCK TRANSFER
  - FACTORY
- Cross-module entries:
  - TRACEABILITY 360
  - REPORTS & EXPORT
- Shared design system: `operations/operations.css`.
- Shared Supabase-backed workspace shell/KPIs: `operations/workspace.js`.
- Cross-domain Traceability search: `operations/traceability-search.js`.
- Autonomous XLSX generator from Supabase: `operations/reports-export.js`.
- Existing Field Buying and RCN TRACE screens remain available behind the workspaces during the transition.

## Supabase migrations applied to project `jmbdgpdthzpszfnddwzi`

1. `operations_suite_mvp_foundations_20260828`
   - target roles added while preserving legacy roles;
   - `operational_sites` and `warehouses` masters;
   - Site/Warehouse links added to reception, lot, BIN cycle and transfer domains;
   - funding-limit history and explicit LBA funding cycles;
   - generic central bag requests/releases and AFLP envelope/allocation tables;
   - RLS and controlled RPC for bag release.
2. `operations_suite_mvp_indexes_policies_20260828`
   - indexes for new FKs and scoped action policies.
3. `operations_suite_bag_accounts_20260828`
   - central bag accounts for canonical warehouses and LBA actors.
4. `operations_suite_workflow_traceability_20260828`
   - LBA and AFLP approval state guards;
   - separation of duties;
   - AFLP envelope over-allocation guard;
   - cross-domain Traceability 360 search projection.
5. `operations_suite_guard_execute_hardening_20260828`
   - trigger guard functions are not directly executable by client roles.

## Canonical operational references seeded

Sites: BOUAKE, BROBO, SAKASSOU, BEOUMI, BOTRO, DIABO, YAKRO.

Warehouses: BKE-001, BKE-002, BKE-003, BKE-004, WH-BROBO, WH-SAKASSOU, WH-BEOUMI, WH-BOTRO, WH-DIABO, YAK-FWH.

These are referential seeds only. No synthetic purchase, financing, delivery, bag request, or stock-transfer business transaction was inserted.

## Business invariants implemented

- Parcel/GPS remains non-blocking for 2027 Field Buying.
- LOT is material identity; Warehouse/BIN references represent physical location.
- LBA direct-to-factory route does not require a synthetic Stock Transfer.
- Approval is separate from physical bag release.
- LBA bag approval requires General Manager role.
- AFLP cluster-to-RT approval requires Branch Manager role after review/consolidation stages.
- Requester cannot approve their own critical bag request.
- Multiple partial bag releases are supported until the approved quantity is exhausted or the approval expires.
- A release cannot exceed remaining authorization or usable stock; an advisory lock protects concurrent releases.
- AFLP cluster allocations cannot exceed the GM-approved campaign envelope.
- Traceability 360 is a `security_invoker` projection over canonical transactions, not a duplicate source of truth.
- Excel export writes values and metadata; it does not recreate fragile external workbook links.

## Intentionally NOT hard-coded

The following remain `À CONFIRMER` and are not invented in code:

- exact LBA Funding Exposure accounting formula;
- Financial Balance sign convention;
- exact RCN Balance convention;
- funding / aging / coverage alert thresholds;
- transfer quality/weight tolerance thresholds;
- campaign AFLP bag-envelope quantity (the 15,000 figure in the design document was an example, not a seed).

## Verification performed

- 7 canonical sites and 10 canonical warehouses created.
- 23 LBA bag actor accounts and 10 warehouse/factory bag accounts created.
- `operations_traceability_search_v` populated from existing canonical data.
- bag workflow trigger functions are not executable directly by `anon` or `authenticated`.
- existing jute-location audit trigger remains enabled after the seed migration.
- Supabase security and performance advisors rerun after changes.

## Known legacy debt not silently altered

The advisor still reports pre-existing RLS duplication/init-plan warnings, old SECURITY DEFINER functions, some missing indexes outside the new objects, backup-schema debt, and leaked-password protection configuration. These should be handled in a dedicated hardening PR rather than changed blindly with this functional migration.

## Deployment gate

This branch changes the root `.html` portal and shared application behavior. Repository policy requires human review. Do not auto-merge. Validate desktop/tablet/mobile navigation and authenticated role access before merging to `main`.
