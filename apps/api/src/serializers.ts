import type { Account, Budget, Category, LedgerSnapshot, Transaction } from "@ledger/shared";

type DateLike = Date | string | null | undefined;

function iso(value: DateLike): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeAccount(account: {
  id: string;
  name: string;
  type: string;
  openingBalanceCents: number;
  color: string;
  version: number;
  updatedAt: Date;
  deletedAt?: Date | null;
}): Account {
  return {
    id: account.id,
    name: account.name,
    type: account.type as Account["type"],
    openingBalanceCents: account.openingBalanceCents,
    color: account.color,
    version: account.version,
    updatedAt: account.updatedAt.toISOString(),
    deletedAt: iso(account.deletedAt)
  };
}

export function serializeCategory(category: {
  id: string;
  name: string;
  kind: string;
  icon: string;
  color: string;
  version: number;
  updatedAt: Date;
  deletedAt?: Date | null;
}): Category {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind as Category["kind"],
    icon: category.icon,
    color: category.color,
    version: category.version,
    updatedAt: category.updatedAt.toISOString(),
    deletedAt: iso(category.deletedAt)
  };
}

export function serializeTransaction(transaction: {
  id: string;
  type: string;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  amountCents: number;
  occurredAt: Date;
  note?: string | null;
  merchant?: string | null;
  tags: string[];
  version: number;
  updatedAt: Date;
  deletedAt?: Date | null;
}): Transaction {
  return {
    id: transaction.id,
    type: transaction.type as Transaction["type"],
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId,
    categoryId: transaction.categoryId,
    amountCents: transaction.amountCents,
    occurredAt: transaction.occurredAt.toISOString(),
    note: transaction.note,
    merchant: transaction.merchant,
    tags: transaction.tags,
    version: transaction.version,
    updatedAt: transaction.updatedAt.toISOString(),
    deletedAt: iso(transaction.deletedAt)
  };
}

export function serializeBudget(budget: {
  id: string;
  categoryId?: string | null;
  month: string;
  amountCents: number;
  version: number;
  updatedAt: Date;
  deletedAt?: Date | null;
}): Budget {
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    month: budget.month,
    amountCents: budget.amountCents,
    version: budget.version,
    updatedAt: budget.updatedAt.toISOString(),
    deletedAt: iso(budget.deletedAt)
  };
}

export function serializeSnapshot(snapshot: {
  accounts: Parameters<typeof serializeAccount>[0][];
  categories: Parameters<typeof serializeCategory>[0][];
  transactions: Parameters<typeof serializeTransaction>[0][];
  budgets: Parameters<typeof serializeBudget>[0][];
  serverVersion: number;
}): LedgerSnapshot {
  return {
    accounts: snapshot.accounts.map(serializeAccount),
    categories: snapshot.categories.map(serializeCategory),
    transactions: snapshot.transactions.map(serializeTransaction),
    budgets: snapshot.budgets.map(serializeBudget),
    serverVersion: snapshot.serverVersion
  };
}
