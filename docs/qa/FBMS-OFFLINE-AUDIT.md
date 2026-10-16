# FBMS Offline Audit

Date: 2026-08-22
Branch: `qa/fbms-offline-sync-hardening`
Status: **NO-GO for current offline queue implementation**

## Critical defect reproduced

The currently deployed Terrain Edge Function stores pending operations in `localStorage` under `fbms_q` and limits the queue to 25 technical operations.

`saveOrQueue(ops, label)` calls `enqueue()` once per technical operation but does not check the returned boolean. It then always displays `enregistré sur le téléphone (hors ligne)` and returns `true`.

This creates a silent partial-write condition when the queue has insufficient remaining capacity for the full logical business transaction.

## Reproduction results

| Existing queue | Transaction ops | Accepted | Atomic? | saveOrQueue return | Success message |
|---:|---:|---:|---|---|---|
| 24 | 2 | 1 | NO | true | YES |
| 23 | 3 | 2 | NO | true | YES |
| 24 | 3 | 1 | NO | true | YES |
| 25 | 2 | 0 | yes, but misleading | true | YES |

The first three cases are direct silent partial-data-loss risks. The last case retains zero operations but still reports success, which is also unacceptable.

## Root cause

1. Capacity is enforced per technical operation instead of per logical transaction.
2. `enqueue()` returns failure but the caller ignores it.
3. `setQueue()` writes directly to `localStorage` without handling quota/storage errors.
4. Multi-step business actions are not represented by a durable transaction state.
5. UI success is based on local control flow rather than a complete persisted transaction acknowledgement.

## Initial remediation committed on this branch

- `shared/offline-outbox.mjs`: atomic enqueue primitive for multi-operation logical transactions.
- `tests/offline-outbox.test.mjs`: boundary tests for 24+2, 23+3, 24+3, 25+2 and local persistence failure.

The new primitive guarantees that a transaction is either fully appended or the queue remains unchanged.

## Test result for remediation primitive

`PASS offline-outbox atomic enqueue tests`

## Important limitation

The deployed Terrain Edge Function source is currently stored in Supabase and is not versioned under `supabase/functions/terrain/` in the GitHub repository. Therefore the production Edge Function has **not** been modified. This is intentional because the connected Supabase project is operational production.

## Recommended next implementation step

1. Version the Terrain Edge Function in GitHub.
2. Integrate the atomic transaction primitive into `saveOrQueue()`.
3. Replace the operation-level queue with a transaction-level outbox.
4. Prefer IndexedDB for durable storage, reusing patterns already present in `shared/farmer-registry-sync.js`.
5. Add transaction states: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED_RETRYABLE`, `FAILED_PERMANENT`.
6. Only show a success message when the complete logical transaction is safely persisted locally or acknowledged by the server.
7. Reproduce all offline failure cases on a dedicated staging backend before deployment.

## Current verdict

- Offline data integrity: **NO-GO**
- Production modified: **NO**
- Production data polluted: **NO**
- 100-user capacity: **NON TESTE**
- Staging load test: **NON TESTE**
