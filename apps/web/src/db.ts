import type { Account, AnalysisNote, Budget, Category, LedgerSnapshot, SyncPayload, Transaction } from "@ledger/shared";
import Dexie, { type Table } from "dexie";

export interface MetaRow {
  key: string;
  value: string;
}

export interface OutboxRow {
  id?: number;
  createdAt: string;
  payload: Partial<SyncPayload>;
}

class LedgerDb extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  budgets!: Table<Budget, string>;
  analysisNotes!: Table<AnalysisNote, string>;
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxRow, number>;

  constructor() {
    super("ledger-box");
    this.version(1).stores({
      accounts: "id, name, deletedAt",
      categories: "id, kind, name, deletedAt",
      transactions: "id, type, accountId, categoryId, occurredAt, deletedAt",
      budgets: "id, month, categoryId, deletedAt",
      meta: "key",
      outbox: "++id, createdAt"
    });
    this.version(2).stores({
      accounts: "id, name, deletedAt",
      categories: "id, kind, name, deletedAt",
      transactions: "id, type, accountId, categoryId, occurredAt, deletedAt",
      budgets: "id, month, categoryId, deletedAt",
      analysisNotes: "id, month, subjectType, subjectKey, deletedAt",
      meta: "key",
      outbox: "++id, createdAt"
    });
  }
}

export const db = new LedgerDb();

export async function saveSnapshot(snapshot: LedgerSnapshot) {
  await db.transaction("rw", [db.accounts, db.categories, db.transactions, db.budgets, db.analysisNotes, db.meta], async () => {
    await db.accounts.bulkPut(snapshot.accounts);
    await db.categories.bulkPut(snapshot.categories);
    await db.transactions.bulkPut(snapshot.transactions);
    await db.budgets.bulkPut(snapshot.budgets);
    await db.analysisNotes.bulkPut(snapshot.analysisNotes ?? []);
    await db.meta.put({ key: "serverVersion", value: String(snapshot.serverVersion) });
    await db.meta.put({ key: "lastSyncAt", value: new Date().toISOString() });
  });
}

export async function resetLocalData() {
  await db.transaction("rw", [db.accounts, db.categories, db.transactions, db.budgets, db.analysisNotes, db.meta, db.outbox], async () => {
    await Promise.all([
      db.accounts.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.budgets.clear(),
      db.analysisNotes.clear(),
      db.meta.clear(),
      db.outbox.clear()
    ]);
  });
}

export async function enqueue(payload: Partial<SyncPayload>) {
  await db.outbox.add({ createdAt: new Date().toISOString(), payload });
}

export async function readOutboxPayload(): Promise<Partial<SyncPayload>> {
  const rows = await db.outbox.toArray();
  return rows.reduce<Partial<SyncPayload>>(
    (merged, row) => {
      merged.accounts = [...(merged.accounts ?? []), ...(row.payload.accounts ?? [])];
      merged.categories = [...(merged.categories ?? []), ...(row.payload.categories ?? [])];
      merged.transactions = [...(merged.transactions ?? []), ...(row.payload.transactions ?? [])];
      merged.budgets = [...(merged.budgets ?? []), ...(row.payload.budgets ?? [])];
      merged.analysisNotes = [...(merged.analysisNotes ?? []), ...(row.payload.analysisNotes ?? [])];
      return merged;
    },
    { accounts: [], categories: [], transactions: [], budgets: [], analysisNotes: [] }
  );
}

export async function clearOutbox() {
  await db.outbox.clear();
}
