# Findings

- `App.tsx` owns the active data arrays and persists changes through `saveLocalAndQueue`, which writes IndexedDB and enqueues for server sync.
- `TransactionList` currently renders a flat `TransactionRows` list after search/type filters.
- `AccountsPanel` only supports create/edit; account delete can be implemented as a soft delete by setting `deletedAt`, incrementing `version`, and saving through the existing account queue.
- `CategoriesPanel` already has category create logic, but the user asked for a smaller quick-add action near the lower-left corner.

