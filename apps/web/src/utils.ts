import { monthKey, type Budget, type Category, type Transaction } from "@ledger/shared";

export const BEIJING_TIME_ZONE = "Asia/Shanghai";
const beijingDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function beijingDateTimeParts(value: string | Date = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = Object.fromEntries(
    beijingDateTimeFormatter
      .formatToParts(safeDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

export function toBeijingDatetimeLocal(value: string | Date = new Date()) {
  const parts = beijingDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function toBeijingTransactionTimestamp(value: string | Date = new Date()) {
  const parts = beijingDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000+08:00`;
}

export function beijingDatetimeLocalToTimestamp(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return toBeijingTransactionTimestamp(value);
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00.000+08:00`;
}

export function dateFromMonthKey(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
}

export function percentDelta(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function daysInMonth(value: string) {
  const date = dateFromMonthKey(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function dateKey(value: string) {
  const parts = beijingDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

export function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

export function shortMonthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year.slice(-2)}/${month.padStart(2, "0")}`;
}

export function yearLabel(value: string) {
  return `${value}年`;
}

export function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function daysInYear(value: string) {
  const year = Number(value);
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

export function categoryPath(category: Category | undefined, categories: Category[]) {
  if (!category) return "";
  const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : undefined;
  if (parent) return `${parent.name} > ${category.name}`;
  return category.name === "其他" ? category.name : `其他 > ${category.name}`;
}

export function isNonDailyExpenseCategory(category: Category | undefined, categories: Category[]) {
  const path = categoryPath(category, categories);
  return /专项支出|非日常支出|未分类大额|贷款本金|本金还款|贷款利息|利息支出|保险|教育培训|课外培训|培训进修|教育|购车|养车|私家车保养/.test(path);
}

export function dailyExpenseTransactions(transactions: Transaction[], categories: Category[]) {
  return transactions.filter((item) => {
    if (item.type !== "expense") return false;
    const category = categories.find((entry) => entry.id === item.categoryId);
    return !isNonDailyExpenseCategory(category, categories);
  });
}

export function specialExpenseTransactions(transactions: Transaction[], categories: Category[]) {
  return transactions.filter((item) => {
    if (item.type !== "expense") return false;
    const category = categories.find((entry) => entry.id === item.categoryId);
    return isNonDailyExpenseCategory(category, categories);
  });
}

export function budgetScope(budget: Budget): "daily" | "total" {
  return budget.scope === "total" ? "total" : "daily";
}

/** 当月日常消费预算：优先取 scope=daily 的无分类预算，否则把所有分类预算相加（兼容旧数据） */
export function monthBudgetTotal(budgets: Budget[], month: string) {
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const overall = monthBudgets.find((budget) => !budget.categoryId && budgetScope(budget) === "daily");
  if (overall) return overall.amountCents;
  return monthBudgets.filter((budget) => budget.categoryId).reduce((sum, budget) => sum + budget.amountCents, 0);
}

/** 当月总开支预算（包含日常消费），无分类且 scope=total */
export function monthTotalBudgetCents(budgets: Budget[], month: string) {
  return budgets.find((budget) => budget.month === month && !budget.categoryId && budgetScope(budget) === "total")?.amountCents ?? 0;
}

export function offsetMonthKey(value: string, offset: number) {
  const date = dateFromMonthKey(value);
  date.setMonth(date.getMonth() + offset);
  return monthKey(date);
}

export function previousMonthKeys(value: string, count: number) {
  return Array.from({ length: count }, (_, index) => offsetMonthKey(value, -(index + 1)));
}

export function categoryAggregateKey(categoryId?: string | null) {
  return categoryId ?? "uncategorized";
}

export function categoryAggregateName(categoryId: string | null, categories: Category[]) {
  if (!categoryId) return "未分类";
  return categoryPath(categories.find((entry) => entry.id === categoryId), categories) || "未分类";
}

export type CategoryExpenseAggregate = {
  id: string;
  categoryId: string | null;
  name: string;
  value: number;
  transactions: Transaction[];
};

export function aggregateCategoryExpenses(transactions: Transaction[], categories: Category[]) {
  const totals = new Map<string, CategoryExpenseAggregate>();
  transactions.forEach((item) => {
    const categoryId = item.categoryId ?? null;
    const id = categoryAggregateKey(categoryId);
    const current = totals.get(id) ?? {
      id,
      categoryId,
      name: categoryAggregateName(categoryId, categories),
      value: 0,
      transactions: []
    };
    current.value += item.amountCents;
    current.transactions.push(item);
    totals.set(id, current);
  });
  return totals;
}

export function categoryBudgetCents(budgets: Budget[], month: string, categoryId: string | null) {
  return budgets.find((budget) => budget.month === month && (budget.categoryId ?? null) === categoryId)?.amountCents ?? 0;
}
