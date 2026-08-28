# LBA Funding Limits — implementation record

Date: 2026-08-28
Branch: `feat/operations-suite-navigation-lba-limits`

## Supabase migrations applied

- `lba_funding_limits_enforcement_20260828`
- `lba_funding_exposure_match_procurement_20260828`

No funding limit amount or synthetic business transaction was seeded.

## Canonical rules

- `lba_funding_limit_history` is the single source of truth for versioned LBA limits.
- A new approved limit preserves the previous version and closes its effective period when appropriate.
- Overlapping `APPROVED` limits for the same LBA are rejected server-side.
- Physical deletion of approved limit history is not exposed to authenticated clients.
- `lba_funding_limit_audit` records limit inserts/updates.
- `lba_funding_exposure_v` mirrors the existing Procurement principle: approved financing minus recognized approved delivery value; delivery value only reduces exposure when its reception is `LIBÉRÉ`.
- `lba_funding_capacity_v` exposes current limit, current exposure, available capacity, utilization, next planned limit and `NO_LIMIT | AVAILABLE | AT_LIMIT | OVER_LIMIT`.
- Financing requests may exist as `À_APPROUVER` even without capacity.
- Approval to `APPROUVÉ` is rejected by PostgreSQL when no active limit exists or projected exposure exceeds the active limit.
- A transaction-level advisory lock serializes approvals per LBA so concurrent approvals cannot bypass the limit.
- Existing `finance_approve` governance is retained for now: Branch Manager, Assistant Branch Manager, Coordination, Administrateur. Final SOP ownership can be revised later without changing the financial invariant.

## Synthetic rollback checks

Executed against production schema inside explicit transactions followed by `ROLLBACK`:

1. 100M limit + 60M approved financing succeeds; an additional 50M approval is rejected.
2. Approval without an active limit is rejected.
3. Overlapping approved limits are rejected.
4. Non-overlapping current/future limits are accepted in the rollback transaction.
5. Post-test residue check: 0 synthetic financing rows and 0 synthetic limit rows.

These are database tests, not a physical field pilot.
