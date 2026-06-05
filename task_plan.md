# Task Plan: Transaction Daily Groups, Account Delete, Quick Category

## Goal
Improve daily transaction browsing, add soft-delete for accounts, and add a small left-side quick category action without changing the cloud/local sync model.

## Steps
- [complete] Inspect existing transaction/account/category components and sync path.
- [complete] Add daily grouped transaction totals with collapsible details.
- [complete] Add account soft-delete action and wire it through local queue sync.
- [complete] Add compact left floating quick-category form.
- [in_progress] Verify typecheck/build and deploy if successful.

## Notes
- Keep all data changes through `saveLocalAndQueue` so offline edits queue and later sync to the server.
- Keep floating buttons above mobile bottom nav and avoid blocking the existing `记一笔` button.

## Implementation Notes
- `TransactionList` now groups filtered transactions by local day and each group header toggles visibility.
- Account delete is a soft delete and retains historical transactions.
- Quick category creation defaults new second-level categories into `其他` and creates that parent if missing.
