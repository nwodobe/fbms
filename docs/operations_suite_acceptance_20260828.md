# Operations Suite — P0 acceptance matrix

This matrix translates the approved functional specification into implementation checks for this branch.

| ID | Acceptance target | Implementation / verification |
|---|---|---|
| AC-01 | Bag approval 2,000 can be released in several parts | `ops_bag_requests.released_qty` + `ops_release_bags()` keeps `PARTIALLY_RELEASED` until approved quantity is exhausted. |
| AC-02 | LBA direct Factory does not create fake transfer | LBA cycle delivery destination type supports `FACTORY_WAREHOUSE`; portal/UI states the routing rule. |
| AC-03 | External warehouse delivery can produce RCN lot/BIN | Canonical `operational_sites` + `warehouses`; reception/lot/BIN domains receive warehouse references. |
| AC-04 | No negative bag stock | `ops_release_bags()` locks source location and rejects quantity above `rcn_jute_v_stock` usable stock. |
| AC-05 | AFLP Cluster→RT release requires BM approval | Generic request state guard requires `BM_APPROVED` before release. |
| AC-06 | LBA warehouse→LBA release requires GM approval | Generic request state guard requires `GM_APPROVED` before release. |
| AC-07 | Parcel optional for 2027 purchase | Existing Field Buying purchase chain is preserved; new portal explicitly retains non-blocking parcel rule. |
| AC-08 | Transfer genealogy remains queryable | Existing RCN genealogy engine reused; cross-domain trace projection includes RCN genealogy and transfers. |
| AC-09 | Excel export autonomous | `reports-export.js` generates values + Metadata, without external workbook formulas. |
| AC-10 | Idempotency | Bag release uses `client_release_id` unique key and returns existing release on retry. |
| AC-11 | Separation of duties | Requester cannot self-approve; approver cannot execute the same release. |
| AC-12 | Audit | Existing domain audit remains enabled; critical new workflow changes are server-validated and central jute movement retains immutable event reference. |

## Not claimed as complete in this branch

- Historical Excel 2026 transactional migration and reconciliation.
- Exact financial exposure/account-balance formulas awaiting Finance sign-off.
- Numeric aging/quality/transfer thresholds awaiting SOP sign-off.
- Full replacement of every legacy RCN TRACE screen by a newly coded screen; stable screens are intentionally reused behind the new workspaces.
- Real field pilot. Automated/database checks do not replace a physical pilot.
