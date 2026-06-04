export type TransactionType = "expense" | "income" | "transfer";
export type AccountType = "cash" | "bank" | "credit" | "alipay" | "wechat" | "investment" | "other";
export type CategoryKind = "expense" | "income";

export interface LedgerEntity {
  id: string;
  version: number;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Account extends LedgerEntity {
  name: string;
  type: AccountType;
  openingBalanceCents: number;
  color: string;
}

export interface Category extends LedgerEntity {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
}

export interface Transaction extends LedgerEntity {
  type: TransactionType;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  amountCents: number;
  occurredAt: string;
  note?: string | null;
  merchant?: string | null;
  tags: string[];
}

export interface Budget extends LedgerEntity {
  categoryId?: string | null;
  month: string;
  amountCents: number;
}

export interface LedgerSnapshot {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  serverVersion: number;
}

export interface SyncPayload {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
}

export const DEFAULT_CATEGORIES: Omit<Category, keyof LedgerEntity>[] = [
  { name: "餐饮", kind: "expense", icon: "utensils", color: "#d45b3f" },
  { name: "交通", kind: "expense", icon: "train", color: "#2f7d86" },
  { name: "购物", kind: "expense", icon: "shopping-bag", color: "#9a6a2f" },
  { name: "居家", kind: "expense", icon: "home", color: "#6b6f3f" },
  { name: "医疗", kind: "expense", icon: "heart-pulse", color: "#b44768" },
  { name: "工资", kind: "income", icon: "briefcase", color: "#2f7d4f" },
  { name: "副业", kind: "income", icon: "sparkles", color: "#6f5fa8" },
  { name: "理财", kind: "income", icon: "line-chart", color: "#ad7f24" }
];

export const DEFAULT_ACCOUNTS: Omit<Account, keyof LedgerEntity>[] = [
  { name: "现金", type: "cash", openingBalanceCents: 0, color: "#31473a" },
  { name: "银行卡", type: "bank", openingBalanceCents: 0, color: "#1f5f74" },
  { name: "支付宝", type: "alipay", openingBalanceCents: 0, color: "#1769aa" },
  { name: "微信", type: "wechat", openingBalanceCents: 0, color: "#24834f" }
];

export function yuanToCents(value: string | number): number {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(text)) {
    throw new Error("金额最多支持两位小数");
  }
  const negative = text.startsWith("-");
  const normalized = negative ? text.slice(1) : text;
  const [yuan = "0", cents = ""] = normalized.split(".");
  const amount = Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
  return negative ? -amount : amount;
}

export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function activeOnly<T extends { deletedAt?: string | null }>(items: T[]): T[] {
  return items.filter((item) => !item.deletedAt);
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function calculateAccountBalance(account: Account, transactions: Transaction[]): number {
  return transactions.filter((item) => !item.deletedAt).reduce((balance, item) => {
    if (item.type === "expense" && item.accountId === account.id) return balance - item.amountCents;
    if (item.type === "income" && item.accountId === account.id) return balance + item.amountCents;
    if (item.type === "transfer" && item.accountId === account.id) return balance - item.amountCents;
    if (item.type === "transfer" && item.toAccountId === account.id) return balance + item.amountCents;
    return balance;
  }, account.openingBalanceCents);
}

export function summarizeMonth(transactions: Transaction[], month = monthKey()) {
  const totals = transactions.filter((item) => !item.deletedAt && item.occurredAt.startsWith(month)).reduce(
    (summary, item) => {
      if (item.type === "expense") summary.expenseCents += item.amountCents;
      if (item.type === "income") summary.incomeCents += item.amountCents;
      return summary;
    },
    { incomeCents: 0, expenseCents: 0, netCents: 0 }
  );
  totals.netCents = totals.incomeCents - totals.expenseCents;
  return totals;
}
