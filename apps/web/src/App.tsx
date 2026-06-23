import {
  activeOnly,
  centsToYuan,
  monthKey,
  summarizeMonth,
  yuanToCents,
  type Account,
  type AnalysisNote,
  type Budget,
  type Category,
  type Transaction,
  type TransactionType
} from "@ledger/shared";
import "./styles.css";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  Download,
  FolderPlus,
  Home,
  ListFilter,
  LogOut,
  Pencil,
  PieChartIcon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "./api";
import { clearOutbox, db, enqueue, readOutboxPayload, resetLocalData, saveSnapshot } from "./db";

type View = "overview" | "entry" | "transactions" | "reports" | "settings" | "trash";
type LedgerGroupMode = "day" | "month" | "year";
type ReportPeriod = "month" | "year";
type ExportFormat = "ledger" | "portable" | "suishouji" | "qianji";
type ExportFileType = "csv" | "xlsx";

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "overview", label: "总览", icon: Home },
  { id: "transactions", label: "流水", icon: ListFilter },
  { id: "reports", label: "报表", icon: PieChartIcon },
  { id: "settings", label: "设置", icon: Settings2 }
];

const typeLabels: Record<TransactionType, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账"
};

const accountTypeLabels: Record<Account["type"], string> = {
  bank: "银行卡",
  cash: "现金",
  credit: "信用卡",
  alipay: "支付宝",
  wechat: "微信",
  investment: "投资",
  loan: "贷款/债务",
  other: "其他"
};

const exportFormats: { id: ExportFormat; label: string }[] = [
  { id: "ledger", label: "完整格式" },
  { id: "portable", label: "通用迁移" },
  { id: "suishouji", label: "随手记兼容" },
  { id: "qianji", label: "钱迹/一木类" }
];

const REPORT_PALETTE = [
  "#d45b3f",
  "#2f7d4f",
  "#1f5f74",
  "#d6b25e",
  "#8a5fb0",
  "#c4517a",
  "#2f7d86",
  "#9a6a2f",
  "#6b6f3f",
  "#b44768",
  "#ad7f24",
  "#4f6f9f"
];

const TREND_PALETTE = [
  "#1f5f74",
  "#2f7d4f",
  "#d6b25e",
  "#8a7154",
  "#6b6f3f",
  "#8a5fb0",
  "#2f7d86",
  "#ad7f24"
];

const BEIJING_TIME_ZONE = "Asia/Shanghai";
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

function beijingDateTimeParts(value: string | Date = new Date()) {
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

function toBeijingDatetimeLocal(value: string | Date = new Date()) {
  const parts = beijingDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function toBeijingTransactionTimestamp(value: string | Date = new Date()) {
  const parts = beijingDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000+08:00`;
}

function beijingDatetimeLocalToTimestamp(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return toBeijingTransactionTimestamp(value);
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00.000+08:00`;
}

function reportColor(index: number) {
  return REPORT_PALETTE[index % REPORT_PALETTE.length];
}

function trendColor(index: number) {
  return TREND_PALETTE[index % TREND_PALETTE.length];
}

function dateFromMonthKey(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
}

function percentDelta(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function daysInMonth(value: string) {
  const date = dateFromMonthKey(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dateKey(value: string) {
  const parts = beijingDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function shortMonthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year.slice(-2)}/${month.padStart(2, "0")}`;
}

function MonthField({ value, onChange, label, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={`period-field ${className}`.trim()}>
      <span className="period-field-label">{label}</span>
      <strong aria-hidden="true">{monthLabel(value)}</strong>
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="month"
      />
    </label>
  );
}

function yearLabel(value: string) {
  return `${value}年`;
}

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
}

function daysInYear(value: string) {
  const year = Number(value);
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function describeDonutSegment(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const safeEnd = Math.min(endAngle, startAngle + 359.99);
  const largeArc = safeEnd - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, safeEnd);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, safeEnd);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function entityStamp() {
  return { id: crypto.randomUUID(), version: 1, updatedAt: new Date().toISOString(), deletedAt: null };
}

function categoryPath(category: Category | undefined, categories: Category[]) {
  if (!category) return "";
  const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : undefined;
  if (parent) return `${parent.name} > ${category.name}`;
  return category.name === "其他" ? category.name : `其他 > ${category.name}`;
}

function selectableCategories(categories: Category[], kind: Category["kind"]) {
  const active = activeOnly(categories).filter((category) => category.kind === kind);
  const parentIds = new Set(active.map((category) => category.parentId).filter(Boolean));
  return active.filter((category) => category.parentId || !parentIds.has(category.id));
}

function summarizeTransactions(transactions: Transaction[]) {
  const totals = transactions.reduce(
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

function transactionGroupKey(item: Transaction, mode: LedgerGroupMode) {
  const day = dateKey(item.occurredAt);
  if (mode === "year") return day.slice(0, 4);
  if (mode === "month") return day.slice(0, 7);
  return day;
}

function transactionGroupLabel(key: string, mode: LedgerGroupMode) {
  if (mode === "year") return yearLabel(key);
  if (mode === "month") return monthLabel(key);
  return dateLabel(key);
}

function transactionGroupTone(key: string, mode: LedgerGroupMode) {
  if (mode !== "day") return "weekday-period";
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return "weekday-period";
  const weekday = new Date(year, month - 1, day).getDay();
  return ["weekday-sun", "weekday-mon", "weekday-tue", "weekday-wed", "weekday-thu", "weekday-fri", "weekday-sat"][weekday];
}

function categoryUsageCounts(transactions: Transaction[], kind: Category["kind"], since?: Date) {
  const counts = new Map<string, number>();
  transactions.forEach((item) => {
    if (item.type !== kind || !item.categoryId) return;
    if (since && new Date(item.occurredAt) < since) return;
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  });
  return counts;
}

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

function sortCategoriesByUsage(categories: Category[], allCategories: Category[], usageCounts: Map<string, number>) {
  return [...categories].sort((left, right) => {
    const usageDelta = (usageCounts.get(right.id) ?? 0) - (usageCounts.get(left.id) ?? 0);
    if (usageDelta !== 0) return usageDelta;
    return categoryPath(left, allCategories).localeCompare(categoryPath(right, allCategories), "zh-CN");
  });
}

function makeCategory(input: {
  name: string;
  kind: Category["kind"];
  parentId?: string | null;
  color?: string;
  icon?: string;
}): Category {
  return {
    ...entityStamp(),
    name: input.name.trim(),
    kind: input.kind,
    parentId: input.parentId ?? null,
    icon: input.icon ?? "circle",
    color: input.color ?? (input.kind === "expense" ? "#d45b3f" : "#2f7d4f")
  };
}

function inferAccountType(name: string): Account["type"] {
  const text = name.toLowerCase();
  if (/贷款|房贷|车贷|借款|负债|借呗|白条|花呗/.test(name)) return "loan";
  if (/信用|credit/.test(text)) return "credit";
  if (/支付宝|alipay/.test(text)) return "alipay";
  if (/微信|wechat/.test(text)) return "wechat";
  if (/现金|cash/.test(text)) return "cash";
  if (/基金|股票|投资|理财/.test(name)) return "investment";
  if (/银行|银行卡|bank|card/.test(text)) return "bank";
  return "other";
}

function mealDefaultAccount(accounts: Account[]) {
  return accounts.find((account) => account.name.includes("招行信用卡6837")) ?? accounts.find((account) => account.name.includes("招行信用卡"));
}

function preferredExpenseAccount(accounts: Account[]) {
  return accounts.find((account) => account.name === "消费卡")
    ?? accounts.find((account) => account.name.includes("招行信用卡6847"))
    ?? accounts.find((account) => account.name.includes("招行信用卡"))
    ?? accounts.find((account) => account.type === "credit")
    ?? accounts[0];
}

function preferredIncomeAccount(accounts: Account[]) {
  return accounts.find((account) => /储蓄卡/.test(account.name))
    ?? accounts.find((account) => /银行卡|宁波|招行/.test(account.name) && account.type === "bank")
    ?? accounts.find((account) => account.type === "bank")
    ?? accounts[0];
}

function quickEntryAccounts(accounts: Account[], type: TransactionType, editing?: Transaction | null) {
  if (editing) {
    const current = accounts.find((account) => account.id === editing.accountId);
    const preferred = type === "income" ? preferredIncomeAccount(accounts) : preferredExpenseAccount(accounts);
    const options = [current, preferred].filter((account): account is Account => Boolean(account));
    return options.filter((account, index, list) => list.findIndex((item) => item.id === account.id) === index);
  }
  if (type === "expense") return [preferredExpenseAccount(accounts)].filter(Boolean) as Account[];
  if (type === "income") return [preferredIncomeAccount(accounts)].filter(Boolean) as Account[];
  return accounts;
}

function mealTimeDefaultCategory(categories: Category[], allCategories: Category[]) {
  const hour = Number(beijingDateTimeParts().hour);
  const pathOf = (category: Category) => categoryPath(category, allCategories);
  const exactPattern = hour >= 5 && hour < 10
    ? /早餐|早饭/
    : hour >= 10 && hour < 15
      ? /午餐|午饭/
      : hour >= 17 && hour < 22
        ? /晚餐|晚饭/
        : null;
  if (!exactPattern) return undefined;
  return categories.find((category) => exactPattern.test(pathOf(category)))
    ?? categories.find((category) => /三餐|早午晚餐/.test(pathOf(category)))
    ?? categories.find((category) => /餐饮|食品|吃饭|用餐/.test(pathOf(category)));
}

function isMealCategory(category: Category | undefined, categories: Category[]) {
  return /早餐|午餐|晚餐|早饭|午饭|晚饭|早午晚餐|三餐|餐饮食品/.test(categoryPath(category, categories));
}

function isNonDailyExpenseCategory(category: Category | undefined, categories: Category[]) {
  const path = categoryPath(category, categories);
  return /专项支出|非日常支出|未分类大额|贷款本金|本金还款|贷款利息|利息支出|保险|教育培训|课外培训|培训进修|教育|购车|养车|私家车保养/.test(path);
}

function dailyExpenseTransactions(transactions: Transaction[], categories: Category[]) {
  return transactions.filter((item) => {
    if (item.type !== "expense") return false;
    const category = categories.find((entry) => entry.id === item.categoryId);
    return !isNonDailyExpenseCategory(category, categories);
  });
}

function specialExpenseTransactions(transactions: Transaction[], categories: Category[]) {
  return transactions.filter((item) => {
    if (item.type !== "expense") return false;
    const category = categories.find((entry) => entry.id === item.categoryId);
    return isNonDailyExpenseCategory(category, categories);
  });
}

function monthBudgetTotal(budgets: Budget[], month: string) {
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const overall = monthBudgets.find((budget) => !budget.categoryId);
  if (overall) return overall.amountCents;
  return monthBudgets.reduce((sum, budget) => sum + budget.amountCents, 0);
}

function offsetMonthKey(value: string, offset: number) {
  const date = dateFromMonthKey(value);
  date.setMonth(date.getMonth() + offset);
  return monthKey(date);
}

function previousMonthKeys(value: string, count: number) {
  return Array.from({ length: count }, (_, index) => offsetMonthKey(value, -(index + 1)));
}

function categoryAggregateKey(categoryId?: string | null) {
  return categoryId ?? "uncategorized";
}

function categoryAggregateName(categoryId: string | null, categories: Category[]) {
  if (!categoryId) return "未分类";
  return categoryPath(categories.find((entry) => entry.id === categoryId), categories) || "未分类";
}

type CategoryExpenseAggregate = {
  id: string;
  categoryId: string | null;
  name: string;
  value: number;
  transactions: Transaction[];
};

function aggregateCategoryExpenses(transactions: Transaction[], categories: Category[]) {
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

function categoryBudgetCents(budgets: Budget[], month: string, categoryId: string | null) {
  return budgets.find((budget) => budget.month === month && (budget.categoryId ?? null) === categoryId)?.amountCents ?? 0;
}

function analysisNoteFor(notes: AnalysisNote[], month: string, subjectType: AnalysisNote["subjectType"], subjectKey: string) {
  return notes.find((note) => note.month === month && note.subjectType === subjectType && note.subjectKey === subjectKey);
}

function otherCategory(categories: Category[], kind: Category["kind"]) {
  return activeOnly(categories).find((category) => category.kind === kind && !category.parentId && category.name === "其他");
}

function viewTitle(view: View) {
  if (view === "entry") return "记一笔";
  return navItems.find((item) => item.id === view)?.label ?? "总览";
}

function accountLimitText(account: Account) {
  const value = Math.abs(account.openingBalanceCents ?? 0);
  return value > 0 ? `¥${centsToYuan(value)}` : "未设置";
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function normalizeFieldName(value: string) {
  return value.replace(/^\ufeff/, "").replace(/\s+/g, "").replace(/[()（）【】\[\]_-]/g, "").toLowerCase();
}

function rowValue(row: Record<string, string>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeFieldName);
  const entry = Object.entries(row).find(([key]) => normalizedAliases.includes(normalizeFieldName(key)));
  return entry?.[1]?.trim() ?? "";
}

function parseMoneyValue(value: string) {
  const normalized = value.replace(/[¥￥元,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!normalized) return 0;
  return yuanToCents(normalized);
}

function parseImportedDate(dateText: string, timeText = "") {
  const raw = `${dateText} ${timeText}`.trim();
  if (!raw) return new Date().toISOString();
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString();
  }
  const normalized = raw
    .replace(/[年月]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/\//g, "-")
    .replace(/\./g, "-");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return new Date().toISOString();
}

function inferTransactionType(row: Record<string, string>, sheetName = ""): TransactionType {
  const typeText = `${rowValue(row, ["类型", "交易类型", "收支类型", "账单类型", "流水类型"])} ${sheetName}`.toLowerCase();
  if (/转账|transfer/.test(typeText)) return "transfer";
  if (/收入|收款|入账|income/.test(typeText)) return "income";
  if (/支出|付款|消费|expense/.test(typeText)) return "expense";
  if (rowValue(row, ["收入", "收入金额", "收款金额", "入账金额"])) return "income";
  return "expense";
}

function importedAmount(row: Record<string, string>, type: TransactionType) {
  const explicit = rowValue(row, ["金额", "交易金额", "金额元", "钱", "数额", "发生金额"]);
  const expense = rowValue(row, ["支出", "支出金额", "付款金额", "消费金额"]);
  const income = rowValue(row, ["收入", "收入金额", "收款金额", "入账金额"]);
  const raw = explicit || (type === "income" ? income : expense) || income || expense;
  return Math.abs(parseMoneyValue(raw || "0"));
}

function splitCategoryName(value: string) {
  const parts = value.split(/[>\/\\｜|·,-]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { primary: parts[0], secondary: parts.slice(1).join(" > ") };
  return { primary: "", secondary: parts[0] ?? "" };
}

function normalizeEducationCategory(kind: Category["kind"], primaryName: string, secondaryName: string, row: Record<string, string>) {
  if (kind !== "expense") return { primaryName, secondaryName };
  const noteText = rowValue(row, ["备注", "说明", "摘要", "用途", "内容", "项目"]);
  const merchantText = rowValue(row, ["商户", "商家", "交易对方", "对象", "店铺"]);
  const text = [primaryName, secondaryName, noteText, merchantText].join(" ");
  const categorySignal = [primaryName, secondaryName].join(" ");
  const childEducationSignal = /孩子教育|亲子教育|学费|托管|延时|课后|暑托|暑假班|培训|兴趣|课程|补习|辅导|机器人|书法|武术|语文|电脑课|夏令营|文具|教辅|课外书|书本杂费|校服|班费|春游|秋游|考级|考试|竞赛|比赛|学校|教育/.test(text);
  if (!childEducationSignal) return { primaryName, secondaryName };
  if (/学习成长|书籍资料|书报杂志/.test(categorySignal) && !/孩子|儿童|学校|学费|托管|延时|课后|暑托|暑假班|教辅|课外|校服|班费/.test(text)) {
    return { primaryName, secondaryName };
  }

  let childName = "教育杂费";
  if (/考级|考试|竞赛|比赛|等级考试/.test(text)) childName = "考试竞赛";
  else if (/春游|秋游|亲子|旅游|活动/.test(text)) childName = "亲子活动";
  else if (/校服|书包|书皮|水杯|作业本|班费/.test(text)) childName = "校服用品";
  else if (/书|文具|教辅|课外阅读|字帖|教材|资料|报纸|杂志|科学大众|少年报|算盘/.test(text)) childName = "图书文具";
  else if (/学费|托管|延时|课后服务|暑托|餐费|伙食费/.test(text)) childName = "学费托管";
  else if (/培训|兴趣|课程|补习|辅导|机器人|书法|武术|语文|电脑课|夏令营|营地|竹笛|葫芦丝|国画|人文素养|硬笔/.test(text)) childName = "兴趣课程";

  return { primaryName: "孩子教育", secondaryName: childName };
}

async function csvRowsFromText(text: string) {
  const { default: Papa } = await import("papaparse");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

function looksLikeImportHeader(row: unknown[]) {
  const normalized = row.map((cell) => normalizeFieldName(String(cell ?? "")));
  const hasDate = normalized.some((cell) => ["日期", "交易日期", "记账日期", "发生日期", "消费日期", "时间", "交易时间"].map(normalizeFieldName).includes(cell));
  const hasAmount = normalized.some((cell) => ["金额", "交易金额", "支出", "收入", "支出金额", "收入金额", "发生金额"].map(normalizeFieldName).includes(cell));
  const hasType = normalized.some((cell) => ["类型", "交易类型", "收支类型", "账单类型", "流水类型"].map(normalizeFieldName).includes(cell));
  return (hasDate && hasAmount) || (hasType && hasAmount);
}

function rowsFromSheetMatrix(matrix: unknown[][], sheetName: string) {
  const headerIndex = matrix.findIndex((row) => looksLikeImportHeader(row));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map((cell, index) => String(cell ?? "").trim() || `列${index + 1}`);
  return matrix.slice(headerIndex + 1).flatMap((cells) => {
    if (cells.every((cell) => String(cell ?? "").trim() === "")) return [];
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = String(cells[index] ?? "").trim();
    });
    row.__sheet = sheetName;
    return [row];
  });
}

async function rowsFromExcel(file: File) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", raw: false });
  return workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    return rowsFromSheetMatrix(matrix, sheetName);
  });
}

function rowsFromHtmlTable(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const rows: Record<string, string>[] = [];
  doc.querySelectorAll("table").forEach((table) => {
    const sheetName = table.querySelector("caption")?.textContent?.trim() ?? "";
    const tableRows = Array.from(table.querySelectorAll("tr"));
    const headers = Array.from(tableRows[0]?.querySelectorAll("th,td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
    tableRows.slice(1).forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td,th")).map((cell) => cell.textContent?.trim() ?? "");
      if (cells.every((cell) => !cell)) return;
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header || `列${index + 1}`] = cells[index] ?? "";
      });
      row.__sheet = sheetName;
      rows.push(row);
    });
  });
  return rows;
}

async function readImportRows(file: File) {
  if (/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
    const rows = await rowsFromExcel(file);
    if (rows.length > 0) return rows;
    throw new Error("没有在 Excel 中识别到账单表头，请确认包含日期、金额、类型、账户、分类等列。");
  }
  const text = await file.text();
  if (/^\s*</.test(text) && /<table/i.test(text)) return rowsFromHtmlTable(text);
  const normalized = text.replace(/\r\n/g, "\n");
  return await csvRowsFromText(normalized);
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((row) => row.map((value) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadXlsx(filename: string, rows: (string | number | null | undefined)[][]) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "账单");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("ledger-token"));
  const [userName, setUserName] = useState(() => localStorage.getItem("ledger-user") ?? "");
  const [view, setView] = useState<View>("entry");
  const [message, setMessage] = useState("准备同步");
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [analysisNotes, setAnalysisNotes] = useState<AnalysisNote[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [entryFocusSignal, setEntryFocusSignal] = useState(0);
  const [quickCategoryOpen, setQuickCategoryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("ledger");
  const [exportFileType, setExportFileType] = useState<ExportFileType>("xlsx");

  const refreshLocal = useCallback(async () => {
    const [nextAccounts, nextCategories, nextTransactions, nextBudgets, nextAnalysisNotes, nextOutboxCount, nextLastSync] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.orderBy("occurredAt").reverse().toArray(),
      db.budgets.toArray(),
      db.analysisNotes.toArray(),
      db.outbox.count(),
      db.meta.get("lastSyncAt")
    ]);
    setAccounts(nextAccounts);
    setCategories(nextCategories);
    setTransactions(nextTransactions);
    setBudgets(nextBudgets);
    setAnalysisNotes(nextAnalysisNotes);
    setOutboxCount(nextOutboxCount);
    setLastSync(nextLastSync?.value);
  }, []);

  const activeAccounts = useMemo(() => activeOnly(accounts), [accounts]);
  const activeCategories = useMemo(() => activeOnly(categories), [categories]);
  const activeTransactions = useMemo(() => activeOnly(transactions), [transactions]);
  const activeBudgets = useMemo(() => activeOnly(budgets), [budgets]);
  const activeAnalysisNotes = useMemo(() => activeOnly(analysisNotes), [analysisNotes]);
  const isLocalPreview = token?.startsWith("local-preview:") ?? false;
  const currentMonth = monthKey();
  const dailyMonthExpenses = useMemo(
    () => dailyExpenseTransactions(activeTransactions.filter((item) => item.occurredAt.startsWith(currentMonth)), activeCategories),
    [activeCategories, activeTransactions, currentMonth]
  );
  const dailyMonthExpenseCents = useMemo(() => dailyMonthExpenses.reduce((sum, item) => sum + item.amountCents, 0), [dailyMonthExpenses]);
  const dailySummary = useMemo(() => ({
    incomeCents: 0,
    expenseCents: dailyMonthExpenseCents,
    netCents: -dailyMonthExpenseCents
  }), [dailyMonthExpenseCents]);
  const currentBudgetCents = useMemo(() => monthBudgetTotal(activeBudgets, currentMonth), [activeBudgets, currentMonth]);

  async function hydrateFromServer(nextToken = token) {
    if (!nextToken) return;
    if (nextToken.startsWith("local-preview:")) {
      await refreshLocal();
      setMessage("本地预览模式");
      return;
    }
    setBusy(true);
    try {
      const snapshot = await api.bootstrap(nextToken);
      await saveSnapshot(snapshot);
      await refreshLocal();
      setMessage("云端数据已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败，已保留本地数据");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!token) return;
    if (isLocalPreview) {
      await refreshLocal();
      setMessage("本地预览数据已保存");
      return;
    }
    setBusy(true);
    try {
      const pending = await readOutboxPayload();
      if (
        (pending.accounts?.length ?? 0) +
          (pending.categories?.length ?? 0) +
          (pending.transactions?.length ?? 0) +
          (pending.budgets?.length ?? 0) +
          (pending.analysisNotes?.length ?? 0) >
        0
      ) {
        const pushed = await api.push(token, pending);
        await clearOutbox();
        await saveSnapshot(pushed);
      } else {
        const pulled = await api.pull(token);
        await saveSnapshot(pulled);
      }
      await refreshLocal();
      setMessage("同步完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "离线中，稍后自动同步");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let syncTimer: number | undefined;

    void refreshLocal().finally(() => {
      if (!token || cancelled) return;
      syncTimer = window.setTimeout(() => {
        if (!cancelled) void hydrateFromServer(token);
      }, 450);
    });

    return () => {
      cancelled = true;
      if (syncTimer) window.clearTimeout(syncTimer);
    };
  }, []);

  useEffect(() => {
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [token]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function signOut() {
    localStorage.removeItem("ledger-token");
    localStorage.removeItem("ledger-user");
    setToken(null);
    setUserName("");
    await resetLocalData();
    await refreshLocal();
  }

  async function saveLocalAndQueue(
    kind: keyof Pick<typeof db, "accounts" | "categories" | "transactions" | "budgets" | "analysisNotes">,
    item: Account | Category | Transaction | Budget | AnalysisNote
  ) {
    await db[kind].put(item as never);
    await enqueue({ [kind]: [item] });
    await refreshLocal();
    if (!isLocalPreview && navigator.onLine) void syncNow();
  }

  async function saveManyLocalAndQueue(kind: "transactions", items: Transaction[]): Promise<void>;
  async function saveManyLocalAndQueue(kind: "categories", items: Category[]): Promise<void>;
  async function saveManyLocalAndQueue(kind: "transactions" | "categories", items: Transaction[] | Category[]) {
    if (items.length === 0) return;
    if (kind === "transactions") await db.transactions.bulkPut(items as Transaction[]);
    else await db.categories.bulkPut(items as Category[]);
    await enqueue({ [kind]: items });
    await refreshLocal();
    if (!isLocalPreview && navigator.onLine) void syncNow();
  }

  const openEntry = useCallback(() => {
    setView("entry");
    setEntryFocusSignal((value) => value + 1);
  }, []);

  if (!token) {
    return <AuthScreen onAuth={async (result) => {
      localStorage.setItem("ledger-token", result.token);
      localStorage.setItem("ledger-user", result.user.name);
      setToken(result.token);
      setUserName(result.user.name);
      await hydrateFromServer(result.token);
    }} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">¥</div>
          <div>
            <strong>Ledger Box</strong>
            <span>{userName || "个人账本"}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)} title={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sync-card">
          <span>{isLocalPreview ? "本地预览" : navigator.onLine ? "在线" : "离线"} · 待同步 {isLocalPreview ? 0 : outboxCount}</span>
          <small>{lastSync ? new Date(lastSync).toLocaleString() : message}</small>
          <button className="icon-button" onClick={syncNow} disabled={busy} title="立即同步">
            <RefreshCw size={18} className={busy ? "spin" : ""} />
          </button>
        </div>
        <button className="ghost danger" onClick={signOut}>
          <LogOut size={18} />
          退出
        </button>
      </aside>

      <main>
        <header className="topbar">
          <div className="page-heading">
            <span className="eyebrow">{currentMonth}</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="app-heading">
            <div className="app-heading-mark"><PieChartIcon size={18} /></div>
            <div>
              <strong>消费分析</strong>
              <span>趋势、预算、支出结构</span>
            </div>
          </div>
        </header>

        {view === "overview" && (
          <Overview summary={dailySummary} budgetCents={currentBudgetCents} accounts={activeAccounts} categories={activeCategories} transactions={activeTransactions} />
        )}
        {view === "entry" && (
          <EntryForm
            accounts={activeAccounts}
            categories={activeCategories}
            transactions={activeTransactions}
            onSave={async (item) => {
              await saveLocalAndQueue("transactions", item);
              setMessage("流水已保存");
              setToast(`${typeLabels[item.type]} ¥${centsToYuan(item.amountCents)} 已记录`);
            }}
            onSaveCategory={(item) => saveLocalAndQueue("categories", item)}
            focusSignal={entryFocusSignal}
          />
        )}
        {view === "transactions" && (
          <TransactionList transactions={activeTransactions} accounts={accounts} categories={categories} onDelete={async (item) => {
            const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
            await saveLocalAndQueue("transactions", deleted);
            setToast("流水已移入回收站");
          }} onEdit={(item) => setEditingTransaction(item)} editingTransaction={editingTransaction} onCancelEdit={() => setEditingTransaction(null)} onSaveEdit={async (item) => {
            await saveLocalAndQueue("transactions", item);
            setEditingTransaction(null);
            setToast("流水已更新");
          }} onBulkUpdate={async (items) => {
            await saveManyLocalAndQueue("transactions", items);
            setToast(`已批量更新 ${items.length} 笔流水`);
          }} onSaveCategory={(item) => saveLocalAndQueue("categories", item)} />
        )}
        {view === "reports" && (
          <Reports
            transactions={activeTransactions}
            accounts={activeAccounts}
            categories={activeCategories}
            budgets={activeBudgets}
            analysisNotes={activeAnalysisNotes}
            onSaveAnalysisNote={(item) => saveLocalAndQueue("analysisNotes", item)}
          />
        )}
        {view === "settings" && (
          <SettingsPanel
            accounts={activeAccounts}
            categories={activeCategories}
            transactions={activeTransactions}
            budgets={activeBudgets}
            exportFormat={exportFormat}
            exportFileType={exportFileType}
            onExportFormatChange={setExportFormat}
            onExportFileTypeChange={setExportFileType}
            onExport={() => void exportData(token, exportFormat, exportFileType, activeAccounts, activeCategories, activeTransactions)}
            onImportFile={(file) => importCsv(file, activeAccounts, activeCategories, saveLocalAndQueue)}
            onImported={(count) => setToast(`已导入 ${count} 笔流水`)}
            onImportError={(error) => setToast(error instanceof Error ? error.message : "导入失败")}
            onSaveAccount={async (item) => {
              await saveLocalAndQueue("accounts", item);
              setToast("账户已保存");
            }}
            onDeleteAccount={async (item) => {
              const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
              await saveLocalAndQueue("accounts", deleted);
              setToast("账户已删除");
            }}
            onSaveBudget={(item) => saveLocalAndQueue("budgets", item)}
            onSaveCategory={(item) => saveLocalAndQueue("categories", item)}
            onDeleteCategories={(items) => saveManyLocalAndQueue("categories", items)}
          />
        )}
        {view === "trash" && (
          <Trash transactions={transactions.filter((item) => item.deletedAt)} accounts={accounts} categories={categories} onRestore={async (item) => {
            const restored = { ...item, deletedAt: null, updatedAt: new Date().toISOString(), version: item.version + 1 };
            await saveLocalAndQueue("transactions", restored);
            setToast("流水已恢复");
          }} />
        )}
        {toast && <div className="save-toast" role="status">{toast}</div>}
        <button className="floating category-fab" onClick={() => setQuickCategoryOpen((value) => !value)} title="快速增加分类"><FolderPlus size={23} /></button>
        {quickCategoryOpen && (
          <QuickCategoryForm
            categories={activeCategories}
            onSave={(item) => saveLocalAndQueue("categories", item)}
            onClose={() => setQuickCategoryOpen(false)}
          />
        )}
        <button className="floating entry-fab" onClick={openEntry} title="记一笔"><Plus size={30} /></button>
      </main>
    </div>
  );
}

function AuthScreen({ onAuth }: { onAuth: (result: Awaited<ReturnType<typeof api.login>>) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = mode === "login" ? await api.login({ email, password }) : await api.register({ email, password, name });
      onAuth(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-panel">
        <div className="brand large">
          <div className="brand-mark">¥</div>
          <div>
            <strong>Ledger Box</strong>
            <span>云端优先的个人记账本</span>
          </div>
        </div>
        <form onSubmit={submit} className="form-stack">
          {mode === "register" && <input value={name} onChange={(event) => setName(event.target.value)} placeholder="昵称" />}
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" type="email" required />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码，至少 8 位" type="password" required minLength={8} />
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? "处理中" : mode === "login" ? "登录" : "创建账本"}</button>
          <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "第一次使用，创建账号" : "已有账号，返回登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Overview({ summary, budgetCents, accounts, categories, transactions }: {
  summary: { incomeCents: number; expenseCents: number; netCents: number };
  budgetCents: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}) {
  const monthTransactions = transactions.filter((item) => item.occurredAt.startsWith(monthKey()));
  const monthExpenseTransactionsAll = monthTransactions.filter((item) => item.type === "expense");
  const monthExpenseTransactions = dailyExpenseTransactions(monthTransactions, categories);
  const specialMonthExpenses = specialExpenseTransactions(monthTransactions, categories);
  const elapsedDays = Math.max(1, new Date().getDate());
  const dailyAverage = Math.round(summary.expenseCents / elapsedDays);
  const totalExpenseCents = monthExpenseTransactionsAll.reduce((sum, item) => sum + item.amountCents, 0);
  const specialExpenseCents = specialMonthExpenses.reduce((sum, item) => sum + item.amountCents, 0);
  const dailyExpenseRatio = totalExpenseCents > 0 ? Math.round((summary.expenseCents / totalExpenseCents) * 100) : 0;
  const specialExpenseRatio = totalExpenseCents > 0 ? Math.round((specialExpenseCents / totalExpenseCents) * 100) : 0;
  const largestExpense = monthExpenseTransactions.reduce((max, item) => Math.max(max, item.amountCents), 0);
  const expenseByCategory = monthExpenseTransactions.reduce((totals, item) => {
    const id = item.categoryId ?? "uncategorized";
    totals.set(id, (totals.get(id) ?? 0) + item.amountCents);
    return totals;
  }, new Map<string, number>());
  const topCategoryEntry = Array.from(expenseByCategory.entries()).sort((left, right) => right[1] - left[1])[0];
  const topCategory = topCategoryEntry ? categories.find((category) => category.id === topCategoryEntry[0]) : undefined;
  const budgetUsage = budgetCents > 0 ? Math.min(100, Math.round((summary.expenseCents / budgetCents) * 100)) : 0;
  const recentTransactions = transactions.slice(0, 4);
  return (
    <section className="overview-dashboard">
      <div className="overview-hero">
        <div className="overview-hero-main">
          <em>{monthLabel(monthKey())}</em>
          <span>本月日常消费</span>
          <strong>¥{centsToYuan(summary.expenseCents)}</strong>
          <p>{budgetCents > 0 ? `日常预算 ¥${centsToYuan(budgetCents)}，剩余 ¥${centsToYuan(Math.max(0, budgetCents - summary.expenseCents))}` : "本月还没有设置日常预算"}</p>
        </div>
        <div className="overview-ring" style={{ "--progress": `${budgetUsage}%` } as CSSProperties}>
          <div>
            <strong>{budgetCents > 0 ? `${budgetUsage}%` : "--"}</strong>
            <span>{budgetCents > 0 ? "预算占用" : "未设预算"}</span>
          </div>
        </div>
      </div>

      <div className="overview-quick-grid">
        <article className="overview-quick-card">
          <span>本月总支出</span>
          <strong>¥{centsToYuan(totalExpenseCents)}</strong>
          <em>日常 + 专项</em>
        </article>
        <article className="overview-quick-card">
          <span>日均消费</span>
          <strong>¥{centsToYuan(dailyAverage)}</strong>
          <em>按已过天数估算</em>
        </article>
        <article className="overview-quick-card">
          <span>最大单笔</span>
          <strong>¥{centsToYuan(largestExpense)}</strong>
          <em>本月日常消费</em>
        </article>
        <article className="overview-quick-card category">
          <span>最大分类</span>
          <strong>{topCategory ? categoryPath(topCategory, categories) : "暂无支出"}</strong>
          <em>{topCategoryEntry ? `¥${centsToYuan(topCategoryEntry[1])}` : "¥0.00"}</em>
        </article>
      </div>

      <section className="panel overview-spending">
        <div className="chart-heading">
          <h2>本月整体支出</h2>
          <strong>¥{centsToYuan(totalExpenseCents)}</strong>
        </div>
        <div className="spending-split">
          <div>
            <span>日常消费</span>
            <strong>¥{centsToYuan(summary.expenseCents)}</strong>
            <em>{dailyExpenseRatio}%</em>
            <div className="bar"><i style={{ width: `${dailyExpenseRatio}%` }} /></div>
          </div>
          <div>
            <span>专项支出</span>
            <strong>¥{centsToYuan(specialExpenseCents)}</strong>
            <em>{specialExpenseRatio}%</em>
            <div className="bar special"><i style={{ width: `${specialExpenseRatio}%` }} /></div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>最近流水</h2>
        <TransactionRows transactions={recentTransactions} accounts={accounts} categories={categories} compact />
      </section>
    </section>
  );
}

function Metric({ title, value, icon: Icon, tone }: { title: string; value: number; icon: typeof Home; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <Icon size={22} />
      <span>{title}</span>
      <strong>¥{centsToYuan(value)}</strong>
    </div>
  );
}

type AmountPadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "00" | "." | "backspace" | "clear";

function triggerHaptic(pattern: VibratePattern = 8) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}

function appendAmountDigits(value: string, digits: string) {
  let next = value.trim();
  for (const digit of digits) {
    if (next.includes(".")) {
      const fraction = next.split(".")[1] ?? "";
      if (fraction.length >= 2) break;
      next += digit;
      continue;
    }
    if (!next || next === "0") {
      next = digit === "0" ? "0" : digit;
      continue;
    }
    if (next.length >= 8) break;
    next += digit;
  }
  return next;
}

function nextAmountValue(value: string, key: AmountPadKey) {
  const current = value.trim();
  if (key === "clear") return "";
  if (key === "backspace") return current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
  return appendAmountDigits(current, key);
}

function AmountKeypad({ value, preview, onChange }: { value: string; preview: string; onChange: (value: string, key: AmountPadKey) => void }) {
  const [confirmedKey, setConfirmedKey] = useState<AmountPadKey | null>(null);
  const keys: { key: AmountPadKey; label: string; tone?: string; ariaLabel?: string }[] = [
    { key: "1", label: "1" },
    { key: "2", label: "2" },
    { key: "3", label: "3" },
    { key: "4", label: "4" },
    { key: "5", label: "5" },
    { key: "6", label: "6" },
    { key: "7", label: "7" },
    { key: "8", label: "8" },
    { key: "9", label: "9" },
    { key: ".", label: "." },
    { key: "0", label: "0" },
    { key: "backspace", label: "退格", tone: "muted", ariaLabel: "删除上一位" }
  ];

  function confirmInput(nextValue: string, key: AmountPadKey) {
    setConfirmedKey(key);
    window.setTimeout(() => setConfirmedKey((current) => current === key ? null : current), 150);
    triggerHaptic(key === "backspace" || key === "clear" ? 12 : 8);
    onChange(nextValue, key);
  }

  return (
    <div className="amount-keypad full" aria-label="金额数字键盘">
      <div className="amount-keypad-head">
        <div>
          <strong>输入金额</strong>
          <span className="keypad-live-amount">¥{preview}</span>
        </div>
        <button type="button" className="amount-keypad-clear" disabled={!value.trim()} onClick={() => confirmInput("", "clear")}>清空</button>
      </div>
      <div className="amount-keypad-grid">
        {keys.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${item.tone ? `amount-key ${item.tone}` : "amount-key"} ${confirmedKey === item.key ? "confirmed" : ""}`.trim()}
            aria-label={item.ariaLabel}
            onClick={() => {
              confirmInput(nextAmountValue(value, item.key), item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EntryForm({ accounts, categories, transactions, onSave, onSaveCategory, editing, onCancel, focusSignal = 0 }: {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  onSave: (item: Transaction) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
  editing?: Transaction | null;
  onCancel?: () => void;
  focusSignal?: number;
}) {
  const [type, setType] = useState<TransactionType>(editing?.type ?? "expense");
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(editing?.toAccountId ?? accounts[1]?.id ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [amount, setAmount] = useState(editing ? centsToYuan(editing.amountCents) : "");
  const [merchant, setMerchant] = useState(editing?.merchant ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [occurredAt, setOccurredAt] = useState(() => editing ? toBeijingDatetimeLocal(editing.occurredAt) : toBeijingDatetimeLocal());
  const [timeTouched, setTimeTouched] = useState(Boolean(editing));
  const [saveFeedback, setSaveFeedback] = useState("");
  const [amountPulse, setAmountPulse] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const categoryKind = type === "income" ? "income" : "expense";
  const recentUsageCounts = useMemo(() => categoryUsageCounts(transactions, categoryKind, monthsAgo(3)), [transactions, categoryKind]);
  const filteredCategories = useMemo(
    () => sortCategoriesByUsage(selectableCategories(categories, categoryKind), categories, recentUsageCounts),
    [categories, categoryKind, recentUsageCounts]
  );
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const recommendedCategory = useMemo(() => {
    if (type === "transfer") return undefined;
    return type === "expense"
      ? mealTimeDefaultCategory(filteredCategories, categories) ?? filteredCategories[0]
      : filteredCategories[0];
  }, [categories, filteredCategories, type]);
  const accountOptions = useMemo(() => {
    const baseOptions = quickEntryAccounts(accounts, type, editing);
    if (editing || type !== "expense" || !isMealCategory(selectedCategory, categories)) return baseOptions;
    const mealAccount = mealDefaultAccount(accounts);
    const options = [mealAccount, ...baseOptions].filter((account): account is Account => Boolean(account));
    return options.filter((account, index, list) => list.findIndex((item) => item.id === account.id) === index);
  }, [accounts, categories, editing, selectedCategory, type]);
  const typeOptions: TransactionType[] = editing ? ["expense", "income", "transfer"] : ["expense", "income"];
  const selectedAccount = accountOptions.find((account) => account.id === accountId) ?? accounts.find((account) => account.id === accountId);
  const selectedTargetAccount = accounts.find((account) => account.id === toAccountId);
  const selectedCategoryPath = selectedCategory ? categoryPath(selectedCategory, categories) : "选择分类";
  const EntryTypeIcon = type === "income" ? ArrowDownLeft : type === "transfer" ? ArrowRightLeft : ArrowUpRight;
  const amountPreview = useMemo(() => {
    const text = amount.trim();
    if (!text) return "0.00";
    try {
      return centsToYuan(yuanToCents(text));
    } catch {
      return text;
    }
  }, [amount]);
  const canSubmit = useMemo(() => {
    try {
      return yuanToCents(amount) > 0;
    } catch {
      return false;
    }
  }, [amount]);
  const entryContext = type === "transfer"
    ? `${selectedAccount?.name ?? "付款账户"} → ${selectedTargetAccount?.name ?? "转入账户"}`
    : `${selectedCategoryPath} · ${selectedAccount?.name ?? "选择账户"}`;
  const entryIntent = type === "income" ? "记录一笔收入" : type === "transfer" ? "记录账户流转" : "记录一笔消费";
  const handleAmountChange = useCallback((nextValue: string) => {
    setAmount((currentValue) => {
      if (nextValue !== currentValue) setAmountPulse((value) => value + 1);
      return nextValue;
    });
  }, []);
  const focusAmountInput = useCallback((force = false) => {
    if (editing) return;
    const input = amountInputRef.current;
    if (!input) return;
    const activeElement = document.activeElement;
    if (
      !force &&
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement !== input &&
      input.form?.contains(activeElement)
    ) {
      return;
    }
    input.focus();
  }, [editing]);
  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setAccountId(editing.accountId);
    setToAccountId(editing.toAccountId ?? "");
    setCategoryId(editing.categoryId ?? "");
    setAmount(centsToYuan(editing.amountCents));
    setMerchant(editing.merchant ?? "");
    setNote(editing.note ?? "");
    setOccurredAt(toBeijingDatetimeLocal(editing.occurredAt));
    setTimeTouched(true);
    setAmountPulse((value) => value + 1);
  }, [editing]);

  useEffect(() => {
    if ((!accountId || !accountOptions.some((account) => account.id === accountId)) && accountOptions[0]) setAccountId(accountOptions[0].id);
    if (type !== "transfer" && !filteredCategories.some((category) => category.id === categoryId)) {
      setCategoryId(recommendedCategory?.id ?? "");
    }
  }, [accountOptions, filteredCategories, accountId, categoryId, recommendedCategory, type]);

  useEffect(() => {
    if (editing || type !== "expense" || !isMealCategory(selectedCategory, categories)) return;
    const mealAccount = mealDefaultAccount(accounts);
    if (mealAccount) setAccountId(mealAccount.id);
  }, [accounts, categories, editing, selectedCategory, type]);

  useEffect(() => {
    if (editing) return undefined;
    const focus = () => focusAmountInput();
    focus();
    const frame = window.requestAnimationFrame(focus);
    const timers = [80, 320, 900].map((delay) => window.setTimeout(focus, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [editing, focusAmountInput, focusSignal]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const item: Transaction = {
      ...(editing ?? entityStamp()),
      type,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      amountCents: yuanToCents(amount),
      occurredAt: editing || timeTouched ? beijingDatetimeLocalToTimestamp(occurredAt) : toBeijingTransactionTimestamp(),
      merchant,
      note,
      tags: editing?.tags ?? [],
      version: editing ? editing.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };
    await onSave(item);
    triggerHaptic([24, 40, 24]);
    if (!editing) {
      setAmount("");
      setAmountPulse((value) => value + 1);
      setMerchant("");
      setNote("");
      setOccurredAt(toBeijingDatetimeLocal());
      setTimeTouched(false);
      setSaveFeedback(`${typeLabels[type]} ¥${centsToYuan(item.amountCents)} 已保存`);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 720);
      window.setTimeout(() => focusAmountInput(true), 0);
      window.setTimeout(() => focusAmountInput(true), 180);
    }
  }

  return (
    <section className={`panel entry-panel entry-panel-${type}`}>
      <div className="entry-hero">
        <div className="entry-hero-top">
          <div className="entry-state">
            <span><EntryTypeIcon size={17} /></span>
            <strong>{editing ? "正在编辑流水" : entryIntent}</strong>
          </div>
          <div className="entry-type-switch">
            {typeOptions.map((item) => (
              <button key={item} className={type === item ? "active" : ""} onClick={() => setType(item)} type="button">{typeLabels[item]}</button>
            ))}
          </div>
        </div>
        <div className={`entry-amount-card ${savedFlash ? "saved" : ""}`.trim()}>
          <span>{type === "income" ? "本次收入" : type === "transfer" ? "流转金额" : "金额"}</span>
          <strong className="entry-amount-value" key={amountPulse}>¥{amountPreview}</strong>
          <small>{entryContext}</small>
        </div>
      </div>
      <form className="form-grid entry-form-grid" onSubmit={submit}>
        {saveFeedback && (
          <div className="save-confirm entry-confirm full" role="status">
            <span className="confirm-mark">✓</span>
            <div>
              <strong>{saveFeedback}</strong>
              <small>已加入流水，可以继续记下一笔</small>
            </div>
          </div>
        )}
        <label className="entry-amount-field full"><span>金额</span><input ref={amountInputRef} value={amount} onChange={(event) => handleAmountChange(event.target.value)} placeholder="0.00" inputMode="decimal" enterKeyHint="done" autoFocus={!editing} required /></label>
        {!editing && <AmountKeypad value={amount} preview={amountPreview} onChange={handleAmountChange} />}
        <label className="entry-account-field">{type === "income" ? "收款账户" : type === "expense" ? "信用卡" : "付款账户"}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {type === "transfer" ? (
          <label>转入账户<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{accounts.filter((item) => item.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        ) : (
          <CategoryPicker categories={categories} options={filteredCategories} usageCounts={recentUsageCounts} kind={categoryKind} value={categoryId} onChange={setCategoryId} onCreate={onSaveCategory} />
        )}
        <details className="entry-more full">
          <summary>时间、商户、备注</summary>
          <div className="entry-more-grid">
            <label className="entry-time-field">时间<input value={occurredAt} onChange={(event) => {
              setOccurredAt(event.target.value);
              setTimeTouched(true);
            }} type="datetime-local" /></label>
            <label>商户<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="超市、餐厅、客户..." /></label>
            <label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明" /></label>
          </div>
        </details>
        <div className="entry-actions full">
          <button className="primary" disabled={!canSubmit}>{editing ? "保存修改" : "保存记录"}</button>
          {editing && onCancel && <button type="button" className="ghost" onClick={onCancel}><X size={16} />取消编辑</button>}
        </div>
      </form>
    </section>
  );
}

function CategoryPicker({ categories, options, usageCounts, kind, value, onChange, onCreate }: {
  categories: Category[];
  options: Category[];
  usageCounts: Map<string, number>;
  kind: Category["kind"];
  value: string;
  onChange: (id: string) => void;
  onCreate: (item: Category) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const queryText = query.trim();
  const normalizedQuery = queryText.toLowerCase();
  const selectedCategory = options.find((category) => category.id === value);
  const matches = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((category) => categoryPath(category, categories).toLowerCase().includes(normalizedQuery));
  }, [categories, normalizedQuery, options]);
  const selectOptions = normalizedQuery && selectedCategory && !matches.some((category) => category.id === selectedCategory.id)
    ? [selectedCategory, ...matches]
    : matches;
  const quickOptions = useMemo(() => {
    if (normalizedQuery) return matches.slice(0, 12);
    const topCategories = options.slice(0, 5);
    if (selectedCategory && !topCategories.some((category) => category.id === selectedCategory.id)) {
      return [selectedCategory, ...topCategories.slice(0, 4)];
    }
    return topCategories;
  }, [matches, normalizedQuery, options, selectedCategory]);
  const hasExactMatch = options.some((category) => {
    const path = categoryPath(category, categories).toLowerCase();
    return path === normalizedQuery || category.name.toLowerCase() === normalizedQuery;
  });
  const canCreate = queryText.length > 0 && !hasExactMatch;

  function chooseCategory(id: string) {
    onChange(id);
    setQuery("");
    setExpanded(false);
  }

  async function createQuickCategory() {
    const name = queryText;
    if (!name) return;
    let parent = otherCategory(categories, kind);
    if (!parent) {
      parent = makeCategory({ name: "其他", kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
      await onCreate(parent);
    }
    const child = makeCategory({ name, kind, parentId: parent.id });
    await onCreate(child);
    onChange(child.id);
    setQuery("");
    setExpanded(false);
  }

  return (
    <div className="category-picker full">
      <div className="category-picker-head">
        <span className="field-label">分类</span>
        <button type="button" className="text-action" onClick={() => setExpanded((value) => !value)}>
          <Search size={14} />{expanded ? "收起" : "搜索"}
        </button>
      </div>
      <div className="category-chip-list">
        {quickOptions.map((category) => (
          <button type="button" className={value === category.id ? "category-chip active" : "category-chip"} key={category.id} onClick={() => chooseCategory(category.id)}>
            {categoryPath(category, categories)}
          </button>
        ))}
        {canCreate && (
          <button type="button" className="category-chip create" onClick={() => void createQuickCategory()}>
            新增：其他 &gt; {queryText}
          </button>
        )}
      </div>
      {expanded && (
        <div className="category-search-panel">
          <div className="category-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (matches[0]) chooseCategory(matches[0].id);
                  else if (canCreate) void createQuickCategory();
                }
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="搜索分类，例如三餐、教育、停车"
            />
            {query && (
              <button type="button" className="category-search-clear" onClick={() => setQuery("")} title="清空搜索">
                <X size={14} />
              </button>
            )}
          </div>
          {normalizedQuery && (
            <small className="category-search-meta">
              {matches.length > 0 ? `找到 ${matches.length} 个匹配分类` : "没有匹配分类，可以新增到其他分类"}
            </small>
          )}
          <select className={normalizedQuery ? "category-select filtered" : "category-select"} value={selectedCategory?.id ?? ""} onChange={(event) => chooseCategory(event.target.value)} required>
            <option value="" disabled>{normalizedQuery ? "选择搜索结果" : "选择分类"}</option>
            {selectOptions.map((category) => {
              const usage = usageCounts.get(category.id) ?? 0;
              return (
                <option key={category.id} value={category.id}>
                  {normalizedQuery && category.id === selectedCategory?.id && !matches.some((item) => item.id === category.id) ? "当前：" : ""}{categoryPath(category, categories)}{usage > 0 ? ` · 常用 ${usage}` : ""}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}

function QuickCategoryForm({ categories, onSave, onClose }: { categories: Category[]; onSave: (item: Category) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [parentId, setParentId] = useState("__other__");
  const [saving, setSaving] = useState(false);
  const activeCategories = activeOnly(categories);
  const parentOptions = activeCategories.filter((category) => !category.parentId && category.kind === kind);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      let nextParentId: string | null = parentId || null;
      if (parentId === "__other__") {
        let parent = otherCategory(activeCategories, kind);
        if (!parent) {
          parent = makeCategory({ name: "其他", kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
          await onSave(parent);
        }
        nextParentId = parent.id;
      }
      await onSave(makeCategory({ name: name.trim(), kind, parentId: nextParentId }));
      setName("");
      setParentId("__other__");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="quick-category-form" onSubmit={submit}>
      <div className="quick-form-head">
        <strong>快速分类</strong>
        <button className="icon-button mini" type="button" onClick={onClose} title="关闭"><X size={14} /></button>
      </div>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="分类名称" autoFocus />
      <div className="quick-form-row">
        <select value={kind} onChange={(event) => {
          setKind(event.target.value as Category["kind"]);
          setParentId("__other__");
        }}>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="__other__">放入其他</option>
          <option value="">一级分类</option>
          {parentOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </div>
      <button className="primary" disabled={saving}>{saving ? "保存中" : "保存分类"}</button>
    </form>
  );
}

function TransactionList({ transactions, accounts, categories, onDelete, onEdit, editingTransaction, onCancelEdit, onSaveEdit, onBulkUpdate, onSaveCategory }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete: (item: Transaction) => Promise<void>;
  onEdit: (item: Transaction) => void;
  editingTransaction: Transaction | null;
  onCancelEdit: () => void;
  onSaveEdit: (item: Transaction) => Promise<void>;
  onBulkUpdate: (items: Transaction[]) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "expense" | "transfer">("all");
  const [groupMode, setGroupMode] = useState<LedgerGroupMode>("day");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [visibleLimit, setVisibleLimit] = useState(120);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchAccountId, setBatchAccountId] = useState("");
  const [batchCategoryId, setBatchCategoryId] = useState("");
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  const [actionTransaction, setActionTransaction] = useState<Transaction | null>(null);
  const activeAccounts = activeOnly(accounts);
  const activeCategories = activeOnly(categories);
  const batchCategory = activeCategories.find((category) => category.id === batchCategoryId);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return transactions
      .filter((item) => item.type !== "income")
      .filter((item) => {
        const category = categories.find((entry) => entry.id === item.categoryId);
        const haystack = [item.note, item.merchant, accounts.find((account) => account.id === item.accountId)?.name, category?.name, categoryPath(category, categories)].join(" ");
        return (type === "all" || item.type === type) && haystack.toLowerCase().includes(needle);
      })
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }, [accounts, categories, query, transactions, type]);
  const visibleTransactions = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const selectedTransactions = useMemo(() => visibleTransactions.filter((item) => selectedIds.has(item.id)), [selectedIds, visibleTransactions]);
  const visibleTransactionIds = useMemo(() => new Set(visibleTransactions.map((item) => item.id)), [visibleTransactions]);
  const transactionGroups = useMemo(() => {
    const groups = new Map<string, { key: string; transactions: Transaction[]; expenseCents: number }>();
    visibleTransactions.forEach((item) => {
      const key = transactionGroupKey(item, groupMode);
      const group = groups.get(key) ?? { key, transactions: [], expenseCents: 0 };
      group.transactions.push(item);
      if (item.type === "expense") group.expenseCents += item.amountCents;
      groups.set(key, group);
    });
    return Array.from(groups.values()).sort((left, right) => right.key.localeCompare(left.key));
  }, [visibleTransactions, groupMode]);

  useEffect(() => {
    setVisibleLimit(120);
    setExpandedGroups(new Set());
    setSelectedIds(new Set());
  }, [query, type, groupMode]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => visibleTransactionIds.has(id))));
  }, [visibleTransactionIds]);

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible() {
    setSelectedIds(new Set(visibleTransactions.map((item) => item.id)));
  }

  function expandLoadedGroups() {
    setExpandedGroups(new Set(transactionGroups.map((group) => group.key)));
  }

  async function applyBatch(updater: (item: Transaction) => Transaction) {
    if (selectedTransactions.length === 0) return;
    await onBulkUpdate(selectedTransactions.map(updater));
    setSelectedIds(new Set());
  }

  function startEdit(item: Transaction) {
    setDetailTransaction(null);
    setActionTransaction(null);
    onEdit(item);
  }

  async function deleteTransaction(item: Transaction) {
    setDetailTransaction(null);
    setActionTransaction(null);
    await onDelete(item);
  }

  return (
    <section className="panel">
      <div className="filters">
        <label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索流水" /></label>
        <select value={type} onChange={(event) => setType(event.target.value as "all" | "expense" | "transfer")}>
          <option value="all">全部</option>
          <option value="expense">支出</option>
          <option value="transfer">转账</option>
        </select>
        <div className="segmented compact group-mode">
          {(["day", "month", "year"] as LedgerGroupMode[]).map((item) => (
            <button key={item} type="button" className={groupMode === item ? "active" : ""} onClick={() => setGroupMode(item)}>
              {item === "day" ? "日" : item === "month" ? "月" : "年"}
            </button>
          ))}
        </div>
      </div>
      <div className="transaction-tools">
        <strong>批量管理</strong>
        <span>已显示 {visibleTransactions.length} / {filtered.length} 笔</span>
        <button type="button" className="ghost" onClick={expandLoadedGroups} disabled={transactionGroups.length === 0}>展开已加载</button>
        <button type="button" className="ghost" onClick={selectVisible} disabled={visibleTransactions.length === 0}>选择当前</button>
        {selectedIds.size > 0 && <button type="button" className="ghost" onClick={() => setSelectedIds(new Set())}>清除选择</button>}
      </div>
      {selectedTransactions.length > 0 && (
        <div className="batch-panel">
          <strong>已选 {selectedTransactions.length} 笔</strong>
          <select value={batchAccountId} onChange={(event) => setBatchAccountId(event.target.value)}>
            <option value="">选择账户</option>
            {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <button type="button" className="ghost" disabled={!batchAccountId} onClick={() => void applyBatch((item) => ({
            ...item,
            accountId: batchAccountId,
            updatedAt: new Date().toISOString(),
            version: item.version + 1
          }))}>批量改账户</button>
          <select value={batchCategoryId} onChange={(event) => setBatchCategoryId(event.target.value)}>
            <option value="">选择分类</option>
            {activeCategories.map((category) => <option key={category.id} value={category.id}>{categoryPath(category, activeCategories)}</option>)}
          </select>
          <button type="button" className="ghost" disabled={!batchCategory} onClick={() => void applyBatch((item) => batchCategory ? {
            ...item,
            type: batchCategory.kind,
            categoryId: batchCategory.id,
            toAccountId: null,
            updatedAt: new Date().toISOString(),
            version: item.version + 1
          } : item)}>批量改分类</button>
          <button type="button" className="ghost danger" onClick={() => void applyBatch((item) => ({
            ...item,
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: item.version + 1
          }))}>批量删除</button>
        </div>
      )}
      {editingTransaction && (
        <div className="edit-panel">
          <h2>编辑流水</h2>
          <EntryForm accounts={accounts} categories={activeCategories} transactions={transactions} editing={editingTransaction} onSave={onSaveEdit} onSaveCategory={onSaveCategory} onCancel={onCancelEdit} />
        </div>
      )}
      {transactionGroups.length === 0 && <p className="empty">暂无记录</p>}
      {transactionGroups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        return (
          <section className={`day-group ${transactionGroupTone(group.key, groupMode)} ${expanded ? "open" : "collapsed"}`} key={group.key}>
            <button className="day-summary" type="button" onClick={() => toggleGroup(group.key)} aria-expanded={expanded}>
              <div>
                <strong>{transactionGroupLabel(group.key, groupMode)}</strong>
                <span>{group.transactions.length} 笔 · 按{groupMode === "day" ? "日" : groupMode === "month" ? "月" : "年"}折叠</span>
              </div>
              <div className="day-totals">
                <span className="expense">支 ¥{centsToYuan(group.expenseCents)}</span>
              </div>
              <span className="fold-indicator">{expanded ? "折叠" : "展开"}</span>
            </button>
            {expanded && (
              <TransactionRows
                transactions={group.transactions}
                accounts={accounts}
                categories={categories}
                onDelete={deleteTransaction}
                onEdit={startEdit}
                onOpen={setDetailTransaction}
                onLongAction={setActionTransaction}
                selectedIds={selectedIds}
                onToggleSelected={toggleSelected}
              />
            )}
          </section>
        );
      })}
      {visibleLimit < filtered.length && (
        <button type="button" className="primary load-more" onClick={() => setVisibleLimit((value) => value + 120)}>
          加载更多流水
        </button>
      )}
      {detailTransaction && (
        <TransactionDetailDrawer
          transaction={detailTransaction}
          accounts={accounts}
          categories={categories}
          onClose={() => setDetailTransaction(null)}
          onDelete={deleteTransaction}
          onEdit={startEdit}
        />
      )}
      {actionTransaction && (
        <TransactionActionSheet
          transaction={actionTransaction}
          accounts={accounts}
          categories={categories}
          onClose={() => setActionTransaction(null)}
          onDelete={deleteTransaction}
          onEdit={startEdit}
        />
      )}
    </section>
  );
}

function TransactionRows({ transactions, accounts, categories, onDelete, onEdit, onOpen, onLongAction, onRestore, selectedIds, onToggleSelected, compact = false }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete?: (item: Transaction) => Promise<void>;
  onEdit?: (item: Transaction) => void;
  onOpen?: (item: Transaction) => void;
  onLongAction?: (item: Transaction) => void;
  onRestore?: (item: Transaction) => Promise<void>;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  compact?: boolean;
}) {
  const longPressTimer = useRef<number | null>(null);
  const suppressNextClick = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress(item: Transaction) {
    if (!onLongAction) return;
    clearLongPressTimer();
    suppressNextClick.current = false;
    longPressTimer.current = window.setTimeout(() => {
      suppressNextClick.current = true;
      onLongAction(item);
    }, 560);
  }

  function finishLongPress() {
    clearLongPressTimer();
  }

  function handleRowClick(item: Transaction) {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    onOpen?.(item);
  }

  if (transactions.length === 0) return <p className="empty">暂无记录</p>;
  return (
    <div className="rows">
      {transactions.map((item) => {
        const account = accounts.find((entry) => entry.id === item.accountId);
        const category = categories.find((entry) => entry.id === item.categoryId);
        const sign = item.type === "expense" ? "-" : item.type === "income" ? "+" : "";
        const title = item.merchant || category?.name || typeLabels[item.type];
        const meta = `${new Date(item.occurredAt).toLocaleDateString()} · ${account?.name ?? ""}${category ? ` · ${category.name}` : ""}`;
        const interactive = Boolean(onOpen || onLongAction);
        const rowClassName = `${onToggleSelected ? "row selectable" : "row"} ${interactive ? "interactive" : ""}`.trim();
        const rowBody = (
          <>
            <div className={`row-icon ${item.type}`}>{item.type === "transfer" ? <ArrowRightLeft size={15} /> : item.type === "income" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</div>
            <div className="row-main">
              <strong>{title}</strong>
              <span>{meta}</span>
            </div>
            <div className="row-side">
              <b>{sign}¥{centsToYuan(item.amountCents)}</b>
              {!compact && !interactive && (
                <div className="row-actions">
                  {onEdit && <button className="icon-button mini" onClick={() => onEdit(item)} title="编辑"><Pencil size={14} /></button>}
                  {onDelete && <button className="icon-button mini" onClick={() => onDelete(item)} title="删除"><Trash2 size={14} /></button>}
                  {onRestore && <button className="icon-button mini" onClick={() => onRestore(item)} title="恢复"><Undo2 size={14} /></button>}
                </div>
              )}
            </div>
          </>
        );
        return (
          <article className={rowClassName} key={item.id}>
            {onToggleSelected && (
              <input
                aria-label="选择流水"
                checked={selectedIds?.has(item.id) ?? false}
                className="row-check"
                onChange={() => onToggleSelected(item.id)}
                type="checkbox"
              />
            )}
            {interactive ? (
              <button
                className="row-content-button"
                onClick={() => handleRowClick(item)}
                onContextMenu={(event) => {
                  if (!onLongAction) return;
                  event.preventDefault();
                  suppressNextClick.current = true;
                  onLongAction(item);
                }}
                onPointerCancel={finishLongPress}
                onPointerDown={() => startLongPress(item)}
                onPointerLeave={finishLongPress}
                onPointerUp={finishLongPress}
                onTouchCancel={finishLongPress}
                onTouchEnd={finishLongPress}
                onTouchMove={finishLongPress}
                onTouchStart={() => startLongPress(item)}
                type="button"
              >
                {rowBody}
              </button>
            ) : (
              <div className="row-content-button passive">{rowBody}</div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function transactionTitle(transaction: Transaction, categories: Category[]) {
  const category = categories.find((entry) => entry.id === transaction.categoryId);
  return transaction.merchant || categoryPath(category, categories) || typeLabels[transaction.type];
}

function transactionDateTimeLabel(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function TransactionDetailDrawer({ transaction, accounts, categories, onClose, onEdit, onDelete, onRestore }: {
  transaction: Transaction;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onEdit?: (item: Transaction) => void;
  onDelete?: (item: Transaction) => Promise<void>;
  onRestore?: (item: Transaction) => Promise<void>;
}) {
  const account = accounts.find((entry) => entry.id === transaction.accountId);
  const targetAccount = accounts.find((entry) => entry.id === transaction.toAccountId);
  const category = categories.find((entry) => entry.id === transaction.categoryId);
  const sign = transaction.type === "expense" ? "-" : transaction.type === "income" ? "+" : "";
  const fields = [
    { label: "类型", value: typeLabels[transaction.type] },
    { label: "分类", value: category ? categoryPath(category, categories) : transaction.type === "transfer" ? "账户流转" : "未分类" },
    { label: "账户", value: account?.name ?? "未记录账户" },
    ...(targetAccount ? [{ label: "转入账户", value: targetAccount.name }] : []),
    { label: "时间", value: transactionDateTimeLabel(transaction.occurredAt) },
    { label: "商户", value: transaction.merchant || "未填写" },
    { label: "备注", value: transaction.note || "未填写" },
    { label: "标签", value: transaction.tags.length > 0 ? transaction.tags.join("、") : "无" },
    { label: "来源", value: "未记录来源" },
    { label: "更新时间", value: transactionDateTimeLabel(transaction.updatedAt) }
  ];

  return (
    <div className="transaction-detail-backdrop" onClick={onClose}>
      <section className="transaction-detail-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="流水详情">
        <div className="transaction-detail-head">
          <div>
            <span>{typeLabels[transaction.type]}</span>
            <h2>{transactionTitle(transaction, categories)}</h2>
          </div>
          <button className="icon-button mini" onClick={onClose} type="button" title="关闭"><X size={15} /></button>
        </div>
        <div className={`transaction-detail-amount ${transaction.type}`}>
          <strong>{sign}¥{centsToYuan(transaction.amountCents)}</strong>
          <span>{transactionDateTimeLabel(transaction.occurredAt)}</span>
        </div>
        <dl className="transaction-detail-grid">
          {fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        {(onEdit || onDelete || onRestore) && (
          <div className="transaction-detail-actions">
            {onEdit && <button className="ghost" onClick={() => onEdit(transaction)} type="button"><Pencil size={16} />编辑</button>}
            {onRestore && <button className="ghost" onClick={() => void onRestore(transaction)} type="button"><Undo2 size={16} />恢复</button>}
            {onDelete && <button className="ghost danger" onClick={() => void onDelete(transaction)} type="button"><Trash2 size={16} />删除</button>}
          </div>
        )}
      </section>
    </div>
  );
}

function TransactionActionSheet({ transaction, accounts, categories, onClose, onEdit, onDelete }: {
  transaction: Transaction;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onEdit: (item: Transaction) => void;
  onDelete: (item: Transaction) => Promise<void>;
}) {
  const account = accounts.find((entry) => entry.id === transaction.accountId);
  return (
    <div className="transaction-action-backdrop" onClick={onClose}>
      <section className="transaction-action-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="流水操作">
        <div>
          <span>流水操作</span>
          <strong>{transactionTitle(transaction, categories)}</strong>
          <em>{account?.name ?? "未记录账户"} · ¥{centsToYuan(transaction.amountCents)}</em>
        </div>
        <button type="button" className="ghost" onClick={() => onEdit(transaction)}><Pencil size={16} />编辑流水</button>
        <button type="button" className="ghost danger" onClick={() => void onDelete(transaction)}><Trash2 size={16} />删除流水</button>
        <button type="button" className="ghost" onClick={onClose}>取消</button>
      </section>
    </div>
  );
}

function SettingsPanel({
  accounts,
  categories,
  transactions,
  budgets,
  exportFormat,
  exportFileType,
  onExportFormatChange,
  onExportFileTypeChange,
  onExport,
  onImportFile,
  onImported,
  onImportError,
  onSaveAccount,
  onDeleteAccount,
  onSaveBudget,
  onSaveCategory,
  onDeleteCategories
}: {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  exportFormat: ExportFormat;
  exportFileType: ExportFileType;
  onExportFormatChange: (format: ExportFormat) => void;
  onExportFileTypeChange: (fileType: ExportFileType) => void;
  onExport: () => void;
  onImportFile: (file: File) => Promise<number>;
  onImported: (count: number) => void;
  onImportError: (error: unknown) => void;
  onSaveAccount: (item: Account) => Promise<void>;
  onDeleteAccount: (item: Account) => Promise<void>;
  onSaveBudget: (item: Budget) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
  onDeleteCategories: (items: Category[]) => Promise<void>;
}) {
  return (
    <section className="settings-stack">
      <SettingsSection title="数据管理" description="导入、导出和数据统计。" defaultOpen>
        <div className="form-stack data-tools-panel">
          <label>导出格式
            <select value={exportFormat} onChange={(event) => onExportFormatChange(event.target.value as ExportFormat)}>
              {exportFormats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>文件类型
            <select value={exportFileType} onChange={(event) => onExportFileTypeChange(event.target.value as ExportFileType)}>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <div className="data-actions">
            <button className="primary" type="button" onClick={onExport}><Download size={17} />导出账单</button>
            <label className="primary import-button">
              <Upload size={17} />
              导入账单
              <input type="file" accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm,text/csv,text/tab-separated-values,text/plain,text/html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  void onImportFile(file).then(onImported).catch(onImportError);
                }
                event.currentTarget.value = "";
              }} />
            </label>
          </div>
          <div className="data-stat-strip">
            <span>{transactions.length} 笔流水</span>
            <span>{accounts.length} 个账户</span>
            <span>{categories.length} 个分类</span>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="账户管理" description="维护储蓄卡、消费卡和额度。">
        <AccountsPanel accounts={accounts} onSave={onSaveAccount} onDelete={onDeleteAccount} />
      </SettingsSection>
      <SettingsSection title="预算管理" description="设置日常支出预算，并查看执行情况。">
        <BudgetPanel budgets={budgets} categories={categories} transactions={transactions} onSave={onSaveBudget} />
      </SettingsSection>
      <SettingsSection title="分类维护" description="按一级、二级分类折叠维护。">
        <CategoriesPanel categories={categories} onSave={onSaveCategory} onDelete={onDeleteCategories} />
      </SettingsSection>
    </section>
  );
}

function SettingsSection({ title, description, children, defaultOpen = false }: { title: string; description: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="settings-section" open={defaultOpen}>
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </summary>
      <div className="settings-section-body">{children}</div>
    </details>
  );
}

function AccountsPanel({ accounts, onSave, onDelete }: { accounts: Account[]; onSave: (item: Account) => Promise<void>; onDelete: (item: Account) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("bank");
  const [color, setColor] = useState("#1f5f74");
  const [limit, setLimit] = useState("");
  const [editing, setEditing] = useState<Account | null>(null);

  function editAccount(account: Account) {
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setColor(account.color);
    setLimit(account.openingBalanceCents ? centsToYuan(Math.abs(account.openingBalanceCents)) : "");
  }

  async function deleteAccount(account: Account) {
    const confirmed = window.confirm(`删除账户“${account.name}”？历史流水会保留，只是不再作为可选账户显示。`);
    if (!confirmed) return;
    if (editing?.id === account.id) {
      setEditing(null);
      setName("");
      setColor("#1f5f74");
      setLimit("");
    }
    await onDelete(account);
  }

  return (
    <section className="grid two account-management">
      <div className="panel management-panel">
        <h2>账户管理</h2>
        <p className="empty">新增、编辑、删除账户集中在设置中维护。</p>
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-line" key={account.id}>
              <i style={{ background: account.color }} />
              <span title={account.name}>{account.name}</span>
              <em>{accountTypeLabels[account.type]} · 额度 {accountLimitText(account)}</em>
              <div className="account-actions">
                <button className="text-action" onClick={() => editAccount(account)} type="button"><Pencil size={15} />编辑</button>
                <button className="text-action danger" onClick={() => void deleteAccount(account)} type="button"><Trash2 size={15} />删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <form className="panel form-stack" onSubmit={async (event) => {
        event.preventDefault();
        await onSave({
          ...(editing ?? entityStamp()),
          name,
          type,
          openingBalanceCents: limit ? yuanToCents(limit) : 0,
          color,
          version: editing ? editing.version + 1 : 1,
          updatedAt: new Date().toISOString(),
          deletedAt: null
        });
        setName("");
        setColor("#1f5f74");
        setLimit("");
        setEditing(null);
      }}>
        <h2>{editing ? "编辑账户" : "新增账户"}</h2>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="账户名称" required />
        <select value={type} onChange={(event) => setType(event.target.value as Account["type"])}>
          <option value="bank">银行卡</option>
          <option value="cash">现金</option>
          <option value="credit">信用卡</option>
          <option value="alipay">支付宝</option>
          <option value="wechat">微信</option>
          <option value="investment">投资</option>
          <option value="loan">贷款/债务</option>
          <option value="other">其他</option>
        </select>
        <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="额度（可选）" inputMode="decimal" />
        <input value={color} onChange={(event) => setColor(event.target.value)} type="color" />
        <button className="primary">保存账户</button>
        {editing && <button type="button" className="ghost" onClick={() => {
          setEditing(null);
          setName("");
          setColor("#1f5f74");
          setLimit("");
        }}>取消编辑</button>}
      </form>
    </section>
  );
}

function CategoriesPanel({ categories, onSave, onDelete }: { categories: Category[]; onSave: (item: Category) => Promise<void>; onDelete: (items: Category[]) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [visibleKind, setVisibleKind] = useState<Category["kind"]>("expense");
  const [parentId, setParentId] = useState("__other__");
  const [editing, setEditing] = useState<Category | null>(null);
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(() => new Set());
  const activeCategories = activeOnly(categories);
  const topCategories = activeCategories.filter((category) => !category.parentId && category.kind === kind && category.id !== editing?.id);
  const groupedParents = activeCategories.filter((category) => !category.parentId && category.kind === visibleKind);

  function editCategory(category: Category) {
    setEditing(category);
    setName(category.name);
    setKind(category.kind);
    setVisibleKind(category.kind);
    setParentId(category.parentId ?? "");
  }

  function toggleCategoryGroup(id: string) {
    setOpenCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteCategory(category: Category) {
    const children = activeCategories.filter((item) => item.parentId === category.id);
    const confirmed = window.confirm(children.length > 0
      ? `删除“${category.name}”及 ${children.length} 个子分类？历史流水会保留。`
      : `删除分类“${category.name}”？历史流水会保留。`);
    if (!confirmed) return;
    const now = new Date().toISOString();
    const deleted = [category, ...children].map((item) => ({
      ...item,
      deletedAt: now,
      updatedAt: now,
      version: item.version + 1
    }));
    if (editing && deleted.some((item) => item.id === editing.id)) {
      setEditing(null);
      setName("");
      setParentId("__other__");
    }
    await onDelete(deleted);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let nextParentId: string | null = parentId || null;
    if (!editing && parentId === "__other__") {
      let parent = otherCategory(activeCategories, kind);
      if (!parent) {
        parent = makeCategory({ name: "其他", kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
        await onSave(parent);
      }
      nextParentId = parent.id;
    }
    await onSave({
      ...(editing ?? makeCategory({ name, kind, parentId: nextParentId })),
      name,
      kind,
      parentId: nextParentId,
      version: editing ? editing.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    setName("");
    setParentId("__other__");
    setEditing(null);
  }

  return (
    <>
      <form className="panel form-stack category-editor-panel" onSubmit={submit}>
        <div className="inline-form-head">
          <div>
            <h2>{editing ? "编辑分类" : "新增分类"}</h2>
            <p>{editing ? `正在编辑：${categoryPath(editing, activeCategories)}` : "新增分类会优先放入“其他”，也可以手动选择一级分类。"}</p>
          </div>
        </div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="分类名称" required />
        <select value={kind} onChange={(event) => setKind(event.target.value as Category["kind"])}>
          <option value="expense">消费</option>
          <option value="income">收入</option>
        </select>
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">作为一级分类</option>
          {!editing && <option value="__other__">放入其他（默认）</option>}
          {topCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button className="primary">保存分类</button>
        {editing && <button type="button" className="ghost" onClick={() => {
          setEditing(null);
          setName("");
          setParentId("__other__");
        }}>取消编辑</button>}
      </form>
      <div className="panel management-panel">
        <h2>分类</h2>
        <p className="empty">先选择一级方向，再展开维护二级分类，日常只维护消费分类即可。</p>
        <div className="segmented compact category-kind-tabs">
          {(["expense", "income"] as Category["kind"][]).map((item) => (
            <button
              key={item}
              type="button"
              className={visibleKind === item ? "active" : ""}
              onClick={() => {
                setVisibleKind(item);
                if (!editing) setKind(item);
              }}
            >
              {item === "expense" ? "消费分类" : "收入分类"}
            </button>
          ))}
        </div>
        <div className="category-tree">
          {groupedParents.map((parent) => {
            const children = activeCategories.filter((category) => category.parentId === parent.id);
            const open = openCategoryIds.has(parent.id);
            const parentEditing = editing?.id === parent.id;
            return (
              <div className="category-group" key={parent.id}>
                <div className={parentEditing ? "category-line editing" : "category-line"}>
                  <button className="category-toggle" type="button" onClick={() => toggleCategoryGroup(parent.id)}>
                    <strong>{parent.name}</strong>
                    <span>{children.length} 个子分类 · {open ? "收起" : "展开"}</span>
                  </button>
                  <button className="text-action" onClick={() => editCategory(parent)} type="button"><Pencil size={15} />编辑</button>
                  <button className="text-action danger" onClick={() => void deleteCategory(parent)} type="button"><Trash2 size={15} />删除</button>
                </div>
                {open && children.map((child) => (
                  <div className={editing?.id === child.id ? "category-line child editing" : "category-line child"} key={child.id}>
                    <span>{child.name}</span>
                    <button className="text-action" onClick={() => editCategory(child)} type="button"><Pencil size={15} />编辑</button>
                    <button className="text-action danger" onClick={() => void deleteCategory(child)} type="button"><Trash2 size={15} />删除</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BudgetPanel({ budgets, categories, transactions, onSave }: {
  budgets: Budget[];
  categories: Category[];
  transactions: Transaction[];
  onSave: (item: Budget) => Promise<void>;
}) {
  const [month, setMonth] = useState(monthKey());
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const expenseCategories = categories.filter((item) => item.kind === "expense");
  const monthExpenses = dailyExpenseTransactions(transactions.filter((item) => item.occurredAt.startsWith(month)), categories);
  return (
    <section className="grid two">
      <div className="panel">
        <h2>预算执行</h2>
        <div className="budget-list">
          {budgets.filter((budget) => budget.month === month).map((budget) => {
            const spent = monthExpenses.filter((item) => !budget.categoryId || item.categoryId === budget.categoryId).reduce((sum, item) => sum + item.amountCents, 0);
            const ratio = Math.min(100, Math.round((spent / budget.amountCents) * 100));
            return (
              <div className="budget-line" key={budget.id}>
                <span>{budget.categoryId ? categories.find((item) => item.id === budget.categoryId)?.name : "日常支出"}</span>
                <strong>¥{centsToYuan(spent)} / ¥{centsToYuan(budget.amountCents)}</strong>
                <div className="bar"><i style={{ width: `${ratio}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
      <form className="panel form-stack" onSubmit={async (event) => {
        event.preventDefault();
        await onSave({ ...entityStamp(), month, categoryId: categoryId || null, amountCents: yuanToCents(amount) });
        setAmount("");
      }}>
        <h2>新增预算</h2>
        <MonthField value={month} onChange={setMonth} label="预算月份" />
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">日常支出</option>
          {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="预算金额" inputMode="decimal" required />
        <button className="primary">保存预算</button>
      </form>
    </section>
  );
}

function InteractiveDonut({ data, total, selectedIndex, onSelect, kind }: {
  data: { id: string; name: string; value: number; color: string }[];
  total: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  kind: Category["kind"];
}) {
  const selected = data[selectedIndex];
  let cursor = 0;
  const segments = data.map((entry, index) => {
    const start = cursor / total * 360;
    cursor += entry.value;
    const end = cursor / total * 360;
    return { ...entry, index, start, end, ratio: Math.round((entry.value / total) * 100) };
  });
  const selectedSegment = segments[selectedIndex];
  const rotation = selectedSegment ? 180 - ((selectedSegment.start + selectedSegment.end) / 2) : 0;

  function selectOffset(offset: number) {
    if (data.length === 0) return;
    onSelect((selectedIndex + offset + data.length) % data.length);
  }

  if (data.length === 0) {
    return (
      <div className="donut-shell empty-donut">
        <div className="donut-center">
          <strong>¥0.00</strong>
          <span>{kind === "expense" ? "分类支出" : "分类收入"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="donut-control">
      <div className="donut-shell">
        <svg className="donut-svg" viewBox="0 0 220 220" role="img" aria-label="分类占比图" style={{ transform: `rotate(${rotation}deg)` }}>
          {segments.map((segment) => (
            <path
              aria-label={`${segment.name} ${segment.ratio}% ¥${centsToYuan(segment.value)}`}
              className={segment.index === selectedIndex ? "donut-segment active" : "donut-segment"}
              d={describeDonutSegment(110, 110, 96, 56, segment.start, segment.end)}
              fill={segment.color}
              key={segment.id}
              onClick={() => onSelect(segment.index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(segment.index);
              }}
            />
          ))}
        </svg>
        <div className="donut-center">
          <strong>¥{centsToYuan(selected?.value ?? total)}</strong>
          <span>{selected?.name ?? "点击饼图看明细"}</span>
          {selectedSegment && <em>{selectedSegment.ratio}%</em>}
        </div>
      </div>
      {selectedSegment && (
        <div className="donut-actions">
          <button type="button" className="ghost" onClick={() => selectOffset(-1)}>上一项</button>
          <button type="button" className="ghost" onClick={() => selectOffset(1)}>下一项</button>
        </div>
      )}
    </div>
  );
}

type AnalysisFinding = {
  id: string;
  tone: "warn" | "neutral" | "good";
  title: string;
  value: string;
  summary: string;
  detail: string;
  evidence: string[];
  transactions: Transaction[];
  sortValue: number;
};

function AnalysisNoteEditor({ value, placeholder, onSave, compact = false }: {
  value: string;
  placeholder: string;
  onSave: (value: string) => Promise<void>;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value);
    setSaved(false);
  }, [value]);

  const changed = draft.trim() !== value.trim();

  return (
    <div className={`analysis-note-editor ${compact ? "compact" : ""}`.trim()}>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setSaved(false);
        }}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
      />
      <button
        type="button"
        className="ghost"
        disabled={saving || (!changed && !draft.trim())}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(draft.trim());
            setSaved(true);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "保存中" : saved ? "已保存" : "保存笔记"}
      </button>
    </div>
  );
}

function ReportScopePill({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="report-scope-pill">
      <span>{label}</span>
      <em>{detail}</em>
    </div>
  );
}

function Reports({ transactions, accounts, categories, budgets, analysisNotes, onSaveAnalysisNote }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  analysisNotes: AnalysisNote[];
  onSaveAnalysisNote: (item: AnalysisNote) => Promise<void>;
}) {
  const currentYear = String(new Date().getFullYear());
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [month, setMonth] = useState(monthKey());
  const [year, setYear] = useState(currentYear);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number | null>(null);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState<number | null>(null);
  const [selectedTotalTrendIndex, setSelectedTotalTrendIndex] = useState<number | null>(null);
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  const categoryKind: Category["kind"] = "expense";
  const selectedYear = year.trim() || currentYear;
  const periodKey = period === "month" ? month : selectedYear;
  const periodLabel = period === "month" ? monthLabel(month) : yearLabel(selectedYear);
  const primaryScopeLabel = period === "month" ? "所选月份" : "所选年份";
  const primaryScopeDetail = period === "month" ? "本月数据" : "年度数据";
  const stickyScopeHint = period === "month"
    ? "除趋势模块外，下方模块均围绕这个月份"
    : "年度汇总为主，趋势模块会单独标出范围";
  const previousKey = period === "month"
    ? (() => {
      const previousDate = dateFromMonthKey(month);
      previousDate.setMonth(previousDate.getMonth() - 1);
      return monthKey(previousDate);
    })()
    : String(Number(selectedYear) - 1);
  const periodDays = period === "month" ? daysInMonth(month) : daysInYear(selectedYear);
  const isCurrentPeriod = period === "month" ? month === monthKey() : selectedYear === currentYear;
  const elapsedDays = isCurrentPeriod ? Math.max(1, period === "month" ? new Date().getDate() : dayOfYear(new Date())) : periodDays;
  const reportTransactions = transactions.filter((item) => item.occurredAt.startsWith(periodKey));
  const previousTransactions = transactions
    .filter((item) => item.occurredAt.startsWith(previousKey))
    .filter((item) => {
      if (!isCurrentPeriod) return true;
      const occurredAt = new Date(item.occurredAt);
      return period === "month" ? occurredAt.getDate() <= elapsedDays : dayOfYear(occurredAt) <= elapsedDays;
    });
  const dailyReportTransactions = dailyExpenseTransactions(reportTransactions, categories);
  const specialReportTransactions = specialExpenseTransactions(reportTransactions, categories);
  const dailyPreviousTransactions = dailyExpenseTransactions(previousTransactions, categories);
  const periodSummary = summarizeTransactions(dailyReportTransactions);
  const specialSummary = summarizeTransactions(specialReportTransactions);
  const previousSummary = summarizeTransactions(dailyPreviousTransactions);
  const expenseChange = percentDelta(periodSummary.expenseCents, previousSummary.expenseCents);
  const expenseChangeText = expenseChange === 0 ? "持平" : expenseChange > 0 ? `增加 ${expenseChange}%` : `下降 ${Math.abs(expenseChange)}%`;
  const rawCategoryTotal = dailyReportTransactions.reduce((sum, item) => sum + item.amountCents, 0);
  const categoryTotal = Math.max(1, rawCategoryTotal);
  const dailyAverageExpense = Math.round(periodSummary.expenseCents / elapsedDays);
  const projectedExpense = Math.round(dailyAverageExpense * periodDays);

  const categoryData = useMemo(() => {
    const totals = new Map<string, { id: string; name: string; value: number; color: string }>();
    dailyReportTransactions.forEach((item) => {
      const category = categories.find((entry) => entry.id === item.categoryId);
      const id = category?.id ?? "uncategorized";
      const current = totals.get(id) ?? {
        id,
        name: category ? categoryPath(category, categories) : "未分类",
        value: 0,
        color: category?.color ?? "#8a7154"
      };
      current.value += item.amountCents;
      totals.set(id, current);
    });
    return Array.from(totals.values())
      .sort((left, right) => right.value - left.value)
      .map((entry, index) => ({ ...entry, color: reportColor(index) }));
  }, [dailyReportTransactions, categories]);

  const specialCategoryData = useMemo(() => {
    const totals = new Map<string, { id: string; name: string; value: number; color: string }>();
    specialReportTransactions.forEach((item) => {
      const category = categories.find((entry) => entry.id === item.categoryId);
      const id = category?.id ?? "uncategorized";
      const current = totals.get(id) ?? {
        id,
        name: category ? categoryPath(category, categories) : "未分类",
        value: 0,
        color: "#8a7154"
      };
      current.value += item.amountCents;
      totals.set(id, current);
    });
    return Array.from(totals.values()).sort((left, right) => right.value - left.value);
  }, [specialReportTransactions, categories]);

  const topExpense = categoryData[0];
  const topExpenseRatio = topExpense && periodSummary.expenseCents > 0 ? Math.round((topExpense.value / periodSummary.expenseCents) * 100) : 0;
  const topThreeExpense = categoryData.slice(0, 3).reduce((sum, item) => sum + item.value, 0);
  const concentrationRatio = periodSummary.expenseCents > 0 ? Math.round((topThreeExpense / periodSummary.expenseCents) * 100) : 0;
  const specialTop = specialCategoryData[0];
  const selectedCategory = selectedCategoryIndex === null ? undefined : categoryData[selectedCategoryIndex];
  const selectedCategoryTransactions = selectedCategory
    ? dailyReportTransactions
      .filter((item) => selectedCategory.id === "uncategorized" ? !item.categoryId : item.categoryId === selectedCategory.id)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    : [];

  const dailyTrendData = Array.from({ length: period === "month" ? 12 : 6 }, (_, index) => {
    const key = period === "month"
      ? (() => {
        const date = dateFromMonthKey(month);
        date.setMonth(date.getMonth() - (11 - index));
        return monthKey(date);
      })()
      : String(Number(selectedYear) - (5 - index));
    const summary = summarizeTransactions(dailyExpenseTransactions(transactions.filter((item) => item.occurredAt.startsWith(key)), categories));
    return {
      period: key,
      expense: summary.expenseCents
    };
  });
  const expenseTrendAnchorMonth = period === "month" ? month : selectedYear === currentYear ? monthKey() : `${selectedYear}-12`;
  const totalExpenseTrendData = Array.from({ length: 12 }, (_, index) => {
    const date = dateFromMonthKey(expenseTrendAnchorMonth);
    date.setMonth(date.getMonth() - (11 - index));
    const key = monthKey(date);
    const summary = summarizeTransactions(transactions.filter((item) => item.type === "expense" && item.occurredAt.startsWith(key)));
    return {
      period: key,
      expense: summary.expenseCents
    };
  });
  const recentExpenseAverage = Math.round(dailyTrendData.slice(-3).reduce((sum, item) => sum + item.expense, 0) / 3);
  const dailyTrendStart = dailyTrendData[0]?.period ?? periodKey;
  const dailyTrendEnd = dailyTrendData[dailyTrendData.length - 1]?.period ?? periodKey;
  const dailyTrendRangeLabel = period === "month"
    ? `${monthLabel(dailyTrendStart)} - ${monthLabel(dailyTrendEnd)}`
    : `${yearLabel(dailyTrendStart)} - ${yearLabel(dailyTrendEnd)}`;
  const totalTrendStart = totalExpenseTrendData[0]?.period ?? expenseTrendAnchorMonth;
  const totalTrendEnd = totalExpenseTrendData[totalExpenseTrendData.length - 1]?.period ?? expenseTrendAnchorMonth;
  const totalExpenseTrendRangeLabel = `${monthLabel(totalTrendStart)} - ${monthLabel(totalTrendEnd)}`;
  const insightCards = [
    {
      id: "top-expense",
      tone: "",
      title: "最大支出项",
      value: topExpense ? topExpense.name : "暂无",
      summary: topExpense ? `占本期支出的 ${topExpenseRatio}%，金额 ¥${centsToYuan(topExpense.value)}。` : "本期还没有支出数据。",
      detail: topExpense
        ? `本期日常消费里，${topExpense.name} 是金额最高的分类。它的占比越高，越适合作为优先复盘项；如果它不是刚性支出，可以先从频率、单次金额、消费场景三个角度找控制空间。`
        : "当前周期没有可分析的日常支出，因此暂时无法判断最大支出项。",
      evidence: topExpense
        ? [`分类金额 ¥${centsToYuan(topExpense.value)}`, `日常消费 ¥${centsToYuan(periodSummary.expenseCents)}`, `占比 ${topExpenseRatio}%`]
        : ["暂无日常支出记录"]
    },
    {
      id: "expense-change",
      tone: expenseChange > 15 ? "warn" : "neutral",
      title: period === "month" ? "日常支出环比" : "日常支出年比",
      value: expenseChangeText,
      summary: `参考历史导入数据中的上一个${period === "month" ? "月" : "年"}${isCurrentPeriod ? "同期" : ""}日常支出；负数表示本期下降。`,
      detail: expenseChange > 15
        ? "本期日常支出增幅较高，建议优先查看分类统计和流水明细，确认是否由高频小额、餐饮出行、临时购物或异常大额造成。"
        : expenseChange < -15
          ? "本期日常支出明显下降，这是一个正向信号。可以进一步确认下降来自主动控制，还是因为部分消费被归入专项支出或还未发生。"
          : "本期和上一参考周期相比变化不大，说明整体消费节奏相对稳定。下一步更适合关注结构，而不是总额。",
      evidence: [`本期日常消费 ¥${centsToYuan(periodSummary.expenseCents)}`, `参考周期 ¥${centsToYuan(previousSummary.expenseCents)}`, `变化 ${expenseChangeText}`]
    },
    {
      id: "daily-average",
      tone: "",
      title: "日均支出",
      value: `¥${centsToYuan(dailyAverageExpense)}`,
      summary: isCurrentPeriod ? `按当前节奏，本${period === "month" ? "月" : "年"}预计支出 ¥${centsToYuan(projectedExpense)}。` : `这是该${period === "month" ? "月" : "年"}实际日均支出。`,
      detail: isCurrentPeriod
        ? "日均支出用于把当前消费节奏投影到整个周期。它不代表最终一定会花这么多，但很适合提前发现预算压力。"
        : "该周期已经结束，所以日均支出反映的是实际消费强度，可以用来和其他月份或年份对比。",
      evidence: [`已统计天数 ${elapsedDays} 天`, `周期天数 ${periodDays} 天`, `预计日常消费 ¥${centsToYuan(projectedExpense)}`]
    },
    {
      id: "concentration",
      tone: concentrationRatio > 65 ? "warn" : "neutral",
      title: "前三支出集中度",
      value: `${concentrationRatio}%`,
      summary: concentrationRatio > 65 ? "支出集中在少数分类，适合优先做专项控制。" : "支出结构相对分散。",
      detail: concentrationRatio > 65
        ? "前三类支出占比偏高，说明控制少数几个分类就可能明显影响总支出。建议先从最高分类开始，避免平均用力。"
        : "支出分布较分散时，单一分类优化带来的效果有限。更适合先设总预算，再观察哪些分类逐渐抬头。",
      evidence: [`前三分类合计 ¥${centsToYuan(topThreeExpense)}`, `日常消费 ¥${centsToYuan(periodSummary.expenseCents)}`, `集中度 ${concentrationRatio}%`]
    },
    {
      id: "recent-average",
      tone: recentExpenseAverage > dailyAverageExpense * periodDays ? "warn" : "neutral",
      title: period === "month" ? "近三月平均消费" : "近三年平均消费",
      value: `¥${centsToYuan(recentExpenseAverage)}`,
      summary: "用长期均值对照当前支出，能更快发现异常月份和一次性大额消费。",
      detail: "近三期平均值能减少单个周期波动的干扰。如果当前周期明显高于均值，通常需要排查异常大额；如果明显低于均值，可以复盘哪些习惯变化带来了改善。",
      evidence: [`近三期平均 ¥${centsToYuan(recentExpenseAverage)}`, `当前周期日常消费 ¥${centsToYuan(periodSummary.expenseCents)}`, `当前预计 ¥${centsToYuan(projectedExpense)}`]
    },
    {
      id: "special-expense",
      tone: specialSummary.expenseCents > periodSummary.expenseCents ? "warn" : "neutral",
      title: "专项支出提醒",
      value: specialTop ? specialTop.name : "暂无",
      summary: specialTop ? `本期专项最高为 ¥${centsToYuan(specialTop.value)}，不纳入正常消费趋势。` : "本期没有贷款、保险、教育或大额未分类专项支出。",
      detail: specialTop
        ? "专项支出已经从日常消费分析中拆出，因此不会扭曲日常趋势。它仍然值得单独关注，尤其是贷款、保险、教育和一次性大额支出。"
        : "本期没有识别到专项支出，当前报表主要反映日常消费行为。",
      evidence: specialTop
        ? [`专项总额 ¥${centsToYuan(specialSummary.expenseCents)}`, `最高专项 ${specialTop.name}`, `最高金额 ¥${centsToYuan(specialTop.value)}`]
        : ["暂无专项支出"]
    }
  ];
  const monthlyAnalysis = useMemo(() => {
    const currentByCategory = aggregateCategoryExpenses(dailyReportTransactions, categories);
    const previousByCategory = aggregateCategoryExpenses(dailyPreviousTransactions, categories);
    const baselineKeys = previousMonthKeys(month, 3);
    const baselineDailyTransactions = dailyExpenseTransactions(
      transactions.filter((item) => baselineKeys.some((key) => item.occurredAt.startsWith(key))),
      categories
    );
    const baselineByCategory = aggregateCategoryExpenses(baselineDailyTransactions, categories);
    const budgetCents = monthBudgetTotal(budgets, month);
    const totalExpenseCents = periodSummary.expenseCents + specialSummary.expenseCents;
    const budgetUsage = budgetCents > 0 ? Math.round((periodSummary.expenseCents / budgetCents) * 100) : 0;
    const findingItems: AnalysisFinding[] = [];

    if (budgetCents > 0 && periodSummary.expenseCents > budgetCents) {
      const overCents = periodSummary.expenseCents - budgetCents;
      findingItems.push({
        id: "over-budget:daily",
        tone: "warn",
        title: "日常消费超预算",
        value: `超 ¥${centsToYuan(overCents)}`,
        summary: `本月日常消费已使用预算 ${budgetUsage}%，需要优先收紧可变消费。`,
        detail: "这是最直接的预算压力信号。建议先查看分类统计里金额最高和增长最快的分类，再判断是必要支出、季节性支出，还是消费习惯抬头。",
        evidence: [`预算 ¥${centsToYuan(budgetCents)}`, `已花 ¥${centsToYuan(periodSummary.expenseCents)}`, `使用 ${budgetUsage}%`],
        transactions: dailyReportTransactions,
        sortValue: overCents
      });
    }

    currentByCategory.forEach((current) => {
      const previous = previousByCategory.get(current.id)?.value ?? 0;
      const baselineAverage = Math.round((baselineByCategory.get(current.id)?.value ?? 0) / 3);
      const categoryBudget = categoryBudgetCents(budgets, month, current.categoryId);
      const monthlyDelta = current.value - previous;
      const baselineDelta = current.value - baselineAverage;
      const sortedTransactions = [...current.transactions].sort((left, right) => right.amountCents - left.amountCents);
      const largest = sortedTransactions[0];
      const priorSingles = baselineDailyTransactions.filter((item) => categoryAggregateKey(item.categoryId) === current.id);
      const priorSingleAverage = priorSingles.length > 0
        ? Math.round(priorSingles.reduce((sum, item) => sum + item.amountCents, 0) / priorSingles.length)
        : 0;

      if (categoryBudget > 0 && current.value > categoryBudget) {
        const ratio = Math.round((current.value / categoryBudget) * 100);
        findingItems.push({
          id: `over-budget:${current.id}`,
          tone: "warn",
          title: "分类超预算",
          value: current.name,
          summary: `${current.name} 已使用预算 ${ratio}%，超出 ¥${centsToYuan(current.value - categoryBudget)}。`,
          detail: "分类预算超标通常比总预算更容易定位问题。建议确认这类支出是价格上涨、频率增加，还是某几笔大额造成。",
          evidence: [`分类预算 ¥${centsToYuan(categoryBudget)}`, `实际 ¥${centsToYuan(current.value)}`, `使用 ${ratio}%`],
          transactions: sortedTransactions,
          sortValue: current.value - categoryBudget
        });
      }

      if (monthlyDelta > 10_000 && (previous === 0 ? current.value > 20_000 : current.value > previous * 1.3)) {
        const change = previous === 0 ? 100 : percentDelta(current.value, previous);
        findingItems.push({
          id: `mom-increase:${current.id}`,
          tone: "warn",
          title: "环比异常上升",
          value: current.name,
          summary: `${current.name} 较上月增加 ¥${centsToYuan(monthlyDelta)}，环比 ${change}%。`,
          detail: "这类变化最容易被日常流水淹没。建议检查是否由消费次数变多、单次金额变大，或某个场景重复发生导致。",
          evidence: [`本月 ¥${centsToYuan(current.value)}`, `上月 ¥${centsToYuan(previous)}`, `增加 ¥${centsToYuan(monthlyDelta)}`],
          transactions: sortedTransactions,
          sortValue: monthlyDelta
        });
      }

      if (monthlyDelta > 0 && baselineAverage > 0 && baselineDelta > 10_000 && current.value > baselineAverage * 1.4) {
        findingItems.push({
          id: `baseline-increase:${current.id}`,
          tone: "warn",
          title: "高于近三月均值",
          value: current.name,
          summary: `${current.name} 高于近三月均值 ¥${centsToYuan(baselineDelta)}。`,
          detail: "近三月均值能过滤单月波动。如果某项持续高于均值，通常说明消费习惯或价格结构已经改变，需要单独复盘。",
          evidence: [`本月 ¥${centsToYuan(current.value)}`, `近三月均值 ¥${centsToYuan(baselineAverage)}`, `高出 ¥${centsToYuan(baselineDelta)}`],
          transactions: sortedTransactions,
          sortValue: baselineDelta
        });
      }

      if (largest && largest.amountCents > 20_000 && (priorSingleAverage === 0 || largest.amountCents > priorSingleAverage * 2)) {
        findingItems.push({
          id: `large-single:${largest.id}`,
          tone: "neutral",
          title: "低频大额单笔",
          value: `¥${centsToYuan(largest.amountCents)}`,
          summary: `${current.name} 出现一笔明显偏大的支出，建议确认是否为一次性必要支出。`,
          detail: "单笔金额突然放大会抬高整月数据。如果它是一次性支出，记备注能避免以后误判消费习惯；如果不是，就值得设置限制或提醒。",
          evidence: [`分类 ${current.name}`, `单笔 ¥${centsToYuan(largest.amountCents)}`, `历史单笔均值 ¥${centsToYuan(priorSingleAverage)}`],
          transactions: [largest],
          sortValue: largest.amountCents
        });
      }
    });

    if (specialSummary.expenseCents > 0) {
      findingItems.push({
        id: "special-expense:month",
        tone: "neutral",
        title: "专项支出独立观察",
        value: `¥${centsToYuan(specialSummary.expenseCents)}`,
        summary: "贷款、保险、教育、大额未分类等已从日常消费中拆出，避免扭曲日常趋势。",
        detail: "专项支出不代表日常消费习惯，但会影响现金流压力。建议给专项支出写清原因、是否一次性、是否可预期，后续做年度统筹时会很有价值。",
        evidence: [`专项支出 ¥${centsToYuan(specialSummary.expenseCents)}`, `全部支出 ¥${centsToYuan(totalExpenseCents)}`, `日常消费 ¥${centsToYuan(periodSummary.expenseCents)}`],
        transactions: specialReportTransactions,
        sortValue: specialSummary.expenseCents
      });
    }

    const comparisonIds = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
    const comparisons = Array.from(comparisonIds).map((id) => {
      const current = currentByCategory.get(id);
      const previous = previousByCategory.get(id);
      const categoryId = current?.categoryId ?? previous?.categoryId ?? null;
      const currentValue = current?.value ?? 0;
      const previousValue = previous?.value ?? 0;
      return {
        id,
        name: current?.name ?? previous?.name ?? categoryAggregateName(categoryId, categories),
        current: currentValue,
        previous: previousValue,
        delta: currentValue - previousValue
      };
    });
    const topIncreases = comparisons.filter((item) => item.delta > 0).sort((left, right) => right.delta - left.delta).slice(0, 3);
    const topDrops = comparisons.filter((item) => item.delta < 0).sort((left, right) => left.delta - right.delta).slice(0, 3);
    const toneRank = { warn: 0, neutral: 1, good: 2 } satisfies Record<AnalysisFinding["tone"], number>;

    return {
      budgetCents,
      budgetUsage,
      totalExpenseCents,
      topIncreases,
      topDrops,
      findings: findingItems
        .sort((left, right) => toneRank[left.tone] - toneRank[right.tone] || right.sortValue - left.sortValue)
        .slice(0, 8)
    };
  }, [
    budgets,
    categories,
    dailyPreviousTransactions,
    dailyReportTransactions,
    month,
    periodSummary.expenseCents,
    specialReportTransactions,
    specialSummary.expenseCents,
    transactions
  ]);
  const monthAnalysisNote = analysisNoteFor(analysisNotes, month, "month", "summary");
  const saveAnalysisNote = useCallback(async (subjectType: AnalysisNote["subjectType"], subjectKey: string, content: string) => {
    const existing = analysisNoteFor(analysisNotes, month, subjectType, subjectKey);
    const now = new Date().toISOString();
    const note: AnalysisNote = {
      ...(existing ?? entityStamp()),
      month,
      subjectType,
      subjectKey,
      content,
      version: existing ? existing.version + 1 : 1,
      updatedAt: now,
      deletedAt: null
    };
    await onSaveAnalysisNote(note);
  }, [analysisNotes, month, onSaveAnalysisNote]);

  useEffect(() => {
    if (selectedCategoryIndex !== null && selectedCategoryIndex > categoryData.length - 1) setSelectedCategoryIndex(null);
  }, [categoryData.length, selectedCategoryIndex]);

  useEffect(() => {
    setSelectedTrendIndex(dailyTrendData.length > 0 ? dailyTrendData.length - 1 : null);
  }, [dailyTrendData.length, month, period, selectedYear]);

  useEffect(() => {
    setSelectedTotalTrendIndex(totalExpenseTrendData.length > 0 ? totalExpenseTrendData.length - 1 : null);
  }, [expenseTrendAnchorMonth, totalExpenseTrendData.length]);

  useEffect(() => {
    setExpandedInsightId(null);
    setDetailTransaction(null);
  }, [month, period, selectedYear]);

  return (
    <section className="report-page">
      <div className="panel report-toolbar">
        <div>
          <h2>分析报表</h2>
          <span>{periodLabel} · 日常消费看趋势，专项支出单独统计</span>
        </div>
        <div className="report-controls">
          <div className="segmented compact">
            {(["month", "year"] as ReportPeriod[]).map((item) => (
              <button key={item} type="button" className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>
                {item === "month" ? "按月" : "按年"}
              </button>
            ))}
          </div>
          {period === "month" ? (
            <MonthField value={month} onChange={setMonth} label="报表月份" className="report-period-field" />
          ) : (
            <input className="year-input" value={year} onChange={(event) => setYear(event.target.value)} type="number" min="1970" max="2100" />
          )}
        </div>
      </div>

      <div className="report-context-anchor" aria-label="当前报表数据范围">
        <div>
          <span>当前查看</span>
          <strong>{periodLabel}</strong>
        </div>
        <em>{stickyScopeHint}</em>
      </div>

      <ReportScopePill label={primaryScopeLabel} detail={`${periodLabel} 汇总，不含历史趋势`} />
      <div className="report-metrics">
        <Metric title={period === "month" ? "日常月消费" : "日常年消费"} value={periodSummary.expenseCents} icon={ArrowUpRight} tone="warn" />
        <Metric title="专项支出" value={specialSummary.expenseCents} icon={Banknote} tone="blue" />
        <Metric title="预计日常消费" value={projectedExpense} icon={ArrowRightLeft} tone="neutral" />
      </div>

      <ReportScopePill label="核心洞察" detail={`${periodLabel} 为主，近三期均值仅作历史参照`} />
      <div className="finance-insights">
        {insightCards.map((card) => {
          const expanded = expandedInsightId === card.id;
          return (
            <article
              aria-expanded={expanded}
              className={`insight-card ${card.tone} ${expanded ? "expanded" : ""}`.trim()}
              key={card.id}
              onClick={() => setExpandedInsightId(expanded ? null : card.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setExpandedInsightId(expanded ? null : card.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span>{card.title}</span>
              <strong>{card.value}</strong>
              <p>{card.summary}</p>
              {expanded && (
                <div className="insight-detail">
                  <b>完整分析</b>
                  <p>{card.detail}</p>
                  <ul>
                    {card.evidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              <em>{expanded ? "收起详情" : "查看详情"}</em>
            </article>
          );
        })}
      </div>

      {period === "month" && (
        <section className="panel monthly-analysis-panel">
          <div className="analysis-panel-head">
            <div>
              <h2>消费异常分析</h2>
              <span>{monthLabel(month)} · 本月异常，历史数据只作参照</span>
            </div>
            <strong>{monthlyAnalysis.findings.length > 0 ? `${monthlyAnalysis.findings.length} 项提醒` : "暂无异常"}</strong>
          </div>
          <div className="analysis-summary-grid">
            <div className={monthlyAnalysis.budgetCents > 0 && monthlyAnalysis.budgetUsage > 100 ? "analysis-summary-card warn" : "analysis-summary-card"}>
              <span>日常预算</span>
              <strong>{monthlyAnalysis.budgetCents > 0 ? `${monthlyAnalysis.budgetUsage}%` : "未设置"}</strong>
              <em>{monthlyAnalysis.budgetCents > 0 ? `¥${centsToYuan(periodSummary.expenseCents)} / ¥${centsToYuan(monthlyAnalysis.budgetCents)}` : "可在设置中补充预算"}</em>
            </div>
            <div className="analysis-summary-card">
              <span>全部支出</span>
              <strong>¥{centsToYuan(monthlyAnalysis.totalExpenseCents)}</strong>
              <em>日常 + 专项</em>
            </div>
            <div className="analysis-summary-card">
              <span>预计日常</span>
              <strong>¥{centsToYuan(projectedExpense)}</strong>
              <em>按当前日均测算</em>
            </div>
          </div>
          <div className="analysis-delta-grid">
            <div>
              <strong>增加最多</strong>
              {monthlyAnalysis.topIncreases.length > 0 ? monthlyAnalysis.topIncreases.map((item) => (
                <span key={item.id}>{item.name} +¥{centsToYuan(item.delta)}</span>
              )) : <span>暂无明显增加</span>}
            </div>
            <div>
              <strong>下降最多</strong>
              {monthlyAnalysis.topDrops.length > 0 ? monthlyAnalysis.topDrops.map((item) => (
                <span key={item.id}>{item.name} -¥{centsToYuan(Math.abs(item.delta))}</span>
              )) : <span>暂无明显下降</span>}
            </div>
          </div>
          <AnalysisNoteEditor
            value={monthAnalysisNote?.content ?? ""}
            placeholder="记录本月复盘：哪些是必要支出，哪些是可优化的消费习惯，哪些需要下月继续观察。"
            onSave={(content) => saveAnalysisNote("month", "summary", content)}
          />
          {monthlyAnalysis.findings.length > 0 ? (
            <div className="anomaly-list">
              {monthlyAnalysis.findings.map((finding) => {
                const note = analysisNoteFor(analysisNotes, month, "anomaly", finding.id);
                return (
                  <details className={`anomaly-card ${finding.tone}`} key={finding.id}>
                    <summary>
                      <div>
                        <span>{finding.title}</span>
                        <strong>{finding.value}</strong>
                        <p>{finding.summary}</p>
                      </div>
                      <em>详情</em>
                    </summary>
                    <div className="anomaly-detail">
                      <p>{finding.detail}</p>
                      <ul>
                        {finding.evidence.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                      <AnalysisNoteEditor
                        compact
                        value={note?.content ?? ""}
                        placeholder="给这条提醒做备注，例如是否一次性、是否可控、下月怎么处理。"
                        onSave={(content) => saveAnalysisNote("anomaly", finding.id, content)}
                      />
                      {finding.transactions.length > 0 && (
                        <TransactionRows
                          transactions={finding.transactions.slice(0, 6)}
                          accounts={accounts}
                          categories={categories}
                          onOpen={setDetailTransaction}
                          compact
                        />
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="empty">本月没有触发显著异常，建议仍保留一条人工复盘笔记，记录是否有即将发生的大额支出。</p>
          )}
        </section>
      )}

      {specialCategoryData.length > 0 && (
        <details className="panel special-expense-panel">
          <summary className="special-expense-summary">
            <div>
              <span>专项支出</span>
              <strong>¥{centsToYuan(specialSummary.expenseCents)}</strong>
            </div>
            <em>{periodLabel} · {specialCategoryData.length} 类 · 单独统计</em>
          </summary>
          <div className="special-expense-grid">
            {specialCategoryData.map((entry) => (
              <div className="budget-line special-expense-line" key={entry.id}>
                <span>{entry.name}</span>
                <strong>¥{centsToYuan(entry.value)}</strong>
                <div className="bar"><i style={{ width: `${Math.max(3, Math.round((entry.value / Math.max(1, specialSummary.expenseCents)) * 100))}%` }} /></div>
              </div>
            ))}
          </div>
        </details>
      )}

      <section className="grid two report-grid">
        <div className="panel chart-panel category-analysis">
          <div className="chart-heading">
            <h2>分类统计</h2>
            <span>{periodLabel} · 日常消费明细</span>
          </div>
          <div className="donut-wrap">
            <InteractiveDonut data={categoryData} total={categoryTotal} selectedIndex={selectedCategoryIndex ?? -1} onSelect={setSelectedCategoryIndex} kind={categoryKind} />
          </div>
          {categoryData.length === 0 && <p className="empty">本期暂无{categoryKind === "expense" ? "支出" : "收入"}分类数据</p>}
          {selectedCategory && (
            <div className="report-category-details">
              <div className="chart-heading">
                <h3>{selectedCategory.name}</h3>
                <span>{selectedCategoryTransactions.length} 笔 · ¥{centsToYuan(selectedCategory.value)}</span>
              </div>
              <TransactionRows transactions={selectedCategoryTransactions.slice(0, 20)} accounts={accounts} categories={categories} onOpen={setDetailTransaction} compact />
              {selectedCategoryTransactions.length > 20 && <p className="empty">已显示最近 20 笔，更多明细可到流水页筛选查看。</p>}
            </div>
          )}
        </div>

        <div className="trend-stack">
          <TrendFoldPanel
            title={period === "month" ? "近12个月消费趋势" : "近6年消费趋势"}
            rangeLabel={dailyTrendRangeLabel}
            legendLabel="日常消费"
            data={dailyTrendData}
            periodKind={period}
            selectedIndex={selectedTrendIndex}
            onSelect={setSelectedTrendIndex}
            colorOffset={0}
          />
          <TrendFoldPanel
            title="近12个月支出趋势"
            rangeLabel={totalExpenseTrendRangeLabel}
            legendLabel="全部支出"
            data={totalExpenseTrendData}
            periodKind="month"
            selectedIndex={selectedTotalTrendIndex}
            onSelect={setSelectedTotalTrendIndex}
            colorOffset={3}
            totalMode
          />
        </div>
      </section>
      {detailTransaction && (
        <TransactionDetailDrawer
          transaction={detailTransaction}
          accounts={accounts}
          categories={categories}
          onClose={() => setDetailTransaction(null)}
        />
      )}
    </section>
  );
}

type TrendPoint = {
  period: string;
  expense: number;
};

function TrendFoldPanel({ title, rangeLabel, legendLabel, data, periodKind, selectedIndex, onSelect, colorOffset = 0, totalMode = false }: {
  title: string;
  rangeLabel: string;
  legendLabel: string;
  data: TrendPoint[];
  periodKind: ReportPeriod;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  colorOffset?: number;
  totalMode?: boolean;
}) {
  const maxTrend = Math.max(1, ...data.map((entry) => entry.expense));
  const activeTrendIndex = selectedIndex ?? data.length - 1;
  const selectedTrend = data[activeTrendIndex] ?? data[data.length - 1];
  const selectedTrendLabel = selectedTrend
    ? periodKind === "month" ? monthLabel(selectedTrend.period) : yearLabel(selectedTrend.period)
    : "暂无数据";
  const trendScopeLabel = totalMode ? "历史支出趋势" : periodKind === "month" ? "历史消费趋势" : "多年消费趋势";

  return (
    <details className={`panel chart-panel trend-panel trend-fold-panel ${totalMode ? "total-trend-panel" : "daily-trend-panel"}`}>
      <summary className="trend-fold-summary">
        <div className="trend-fold-title">
          <div className="trend-title-row">
            <h2>{title}</h2>
            <b>{trendScopeLabel}</b>
          </div>
          <span>{rangeLabel}</span>
        </div>
        <div className="trend-fold-status">
          <span>{selectedTrendLabel}</span>
          <strong>¥{centsToYuan(selectedTrend?.expense ?? 0)}</strong>
        </div>
      </summary>
      <div className="trend-fold-body">
        <div className="trend-legend trend-expanded-legend">
          <span><i className={`legend ${totalMode ? "expense-trend-swatch" : "trend-swatch"}`} />{legendLabel}</span>
          <em>{periodKind === "month" ? "按月查看" : "按年查看"}</em>
        </div>
        <div className="trend-selected" key={selectedTrend?.period ?? "empty"}>
          <span>{selectedTrendLabel}</span>
          <strong>¥{centsToYuan(selectedTrend?.expense ?? 0)}</strong>
          <em>点击下方{periodKind === "month" ? "月份" : "年份"}查看金额</em>
        </div>
        <div className={`trend-bars trend-bar-list ${periodKind === "month" ? "monthly-trend" : "yearly-trend"}`}>
          {data.map((item, index) => {
            const rowColor = trendColor(index + colorOffset);
            const isActive = index === activeTrendIndex;
            const fillWidth = item.expense > 0 ? Math.max(3, (item.expense / maxTrend) * 100) : 0;
            const label = periodKind === "month" ? shortMonthLabel(item.period) : item.period;
            const fullLabel = periodKind === "month" ? monthLabel(item.period) : yearLabel(item.period);
            return (
              <button
                aria-label={`${fullLabel} ${legendLabel} ¥${centsToYuan(item.expense)}`}
                aria-pressed={isActive}
                className={isActive ? "trend-row active" : "trend-row"}
                key={item.period}
                onClick={() => onSelect(index)}
                style={{ "--row-color": rowColor } as CSSProperties}
                type="button"
              >
                <span className="trend-y-label">{label}</span>
                <span className="trend-track">
                  <i
                    className="trend-fill trend-bar"
                    title={`${legendLabel} ¥${centsToYuan(item.expense)}`}
                    style={{
                      "--trend-color": rowColor,
                      width: `${fillWidth}%`
                    } as CSSProperties}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function Trash({ transactions, accounts, categories, onRestore }: { transactions: Transaction[]; accounts: Account[]; categories: Category[]; onRestore: (item: Transaction) => Promise<void> }) {
  return (
    <section className="panel">
      <TransactionRows transactions={transactions} accounts={accounts} categories={categories} onRestore={onRestore} />
    </section>
  );
}

async function importCsv(
  file: File,
  accounts: Account[],
  categories: Category[],
  saveLocalAndQueue: (kind: "accounts" | "categories" | "transactions", item: Account | Category | Transaction) => Promise<void>
) {
  const rows = await readImportRows(file);
  const nextAccounts = [...accounts];
  const nextCategories = [...categories];

  async function findOrCreateAccount(name: string) {
    const accountName = name.trim() || nextAccounts[0]?.name || "导入账户";
    const existing = nextAccounts.find((item) => item.name === accountName);
    if (existing) return existing;
    const account: Account = { ...entityStamp(), name: accountName, type: inferAccountType(accountName), openingBalanceCents: 0, color: "#8a7154" };
    nextAccounts.push(account);
    await saveLocalAndQueue("accounts", account);
    return account;
  }

  async function findOrCreateCategory(kind: Category["kind"], row: Record<string, string>) {
    const combined = rowValue(row, ["分类", "类别", "账目分类", "收支分类", "科目"]);
    const split = splitCategoryName(combined);
    const importedPrimaryName = rowValue(row, ["一级分类", "大类", "父分类"]) || split.primary || "其他";
    const importedSecondaryName = rowValue(row, ["二级分类", "子分类", "小类", "明细分类"]) || split.secondary;
    const { primaryName, secondaryName } = normalizeEducationCategory(kind, importedPrimaryName, importedSecondaryName, row);
    let parent = nextCategories.find((item) => item.kind === kind && !item.parentId && item.name === primaryName);
    if (!parent) {
      parent = makeCategory({ name: primaryName, kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
      nextCategories.push(parent);
      await saveLocalAndQueue("categories", parent);
    }
    if (!secondaryName || secondaryName === parent.name) return parent;
    let child = nextCategories.find((item) => item.kind === kind && item.parentId === parent.id && item.name === secondaryName);
    if (!child) {
      child = makeCategory({ name: secondaryName, kind, parentId: parent.id, color: parent.color });
      nextCategories.push(child);
      await saveLocalAndQueue("categories", child);
    }
    return child;
  }

  let imported = 0;
  for (const row of rows) {
    const type = inferTransactionType(row, row.__sheet);
    const amountCents = importedAmount(row, type);
    if (amountCents <= 0) continue;
    const account = await findOrCreateAccount(rowValue(row, ["账户", "账户1", "支付账户", "付款账户", "收支账户", "资金账户", "银行卡"]));
    const toAccountName = rowValue(row, ["转入账户", "账户2", "收款账户", "对方账户"]);
    const toAccount = type === "transfer" ? await findOrCreateAccount(toAccountName || "转入账户") : null;
    const category = type === "transfer" ? null : await findOrCreateCategory(type === "income" ? "income" : "expense", row);
    const defaultMealAccount = type === "expense" && isMealCategory(category ?? undefined, nextCategories) ? mealDefaultAccount(nextAccounts) : undefined;
    const dateText = rowValue(row, ["日期", "交易日期", "记账日期", "发生日期", "消费日期"]);
    const timeText = rowValue(row, ["时间", "交易时间", "发生时间"]);
    await saveLocalAndQueue("transactions", {
      ...entityStamp(),
      type,
      accountId: defaultMealAccount?.id ?? account.id,
      toAccountId: toAccount?.id ?? null,
      categoryId: category?.id ?? null,
      amountCents,
      occurredAt: parseImportedDate(dateText || rowValue(row, ["交易时间", "发生时间"]), timeText),
      merchant: rowValue(row, ["商户", "商家", "交易对方", "对象", "店铺"]),
      note: rowValue(row, ["备注", "说明", "摘要", "用途", "内容", "项目"]),
      tags: rowValue(row, ["标签", "成员"]).split(/[|,，、]/).map((item) => item.trim()).filter(Boolean)
    });
    imported += 1;
  }
  return imported;
}

function localExportRows(format: ExportFormat, accounts: Account[], categories: Category[], transactions: Transaction[]) {
  const accountName = (id?: string | null) => accounts.find((item) => item.id === id)?.name ?? "";
  const categoryName = (id?: string | null) => {
    const category = categories.find((item) => item.id === id);
    return category ? categoryPath(category, categories) : "";
  };
  const typeName = (type: TransactionType) => typeLabels[type];
  const rows = transactions.map((item) => {
    const date = new Date(item.occurredAt);
    const day = date.toISOString().slice(0, 10);
    const time = date.toISOString().slice(11, 19);
    if (format === "portable") {
      const parts = splitCategoryName(categoryName(item.categoryId));
      return [day, time, typeName(item.type), parts.primary, parts.secondary || categoryName(item.categoryId), accountName(item.accountId), accountName(item.toAccountId), item.type === "expense" ? `-${centsToYuan(item.amountCents)}` : centsToYuan(item.amountCents), item.merchant, item.note, item.tags.join("|")];
    }
    if (format === "suishouji") {
      const parts = splitCategoryName(categoryName(item.categoryId));
      return [typeName(item.type), day, time, parts.primary || "其他", parts.secondary || categoryName(item.categoryId) || "其他", accountName(item.accountId), accountName(item.toAccountId), centsToYuan(item.amountCents), item.merchant, item.note];
    }
    if (format === "qianji") {
      return [day, typeName(item.type), categoryName(item.categoryId) || "其他", accountName(item.accountId), centsToYuan(item.amountCents), item.merchant, item.note];
    }
    return [item.occurredAt, item.type, accountName(item.accountId), accountName(item.toAccountId), categoryName(item.categoryId), centsToYuan(item.amountCents), item.merchant, item.note, item.tags.join("|")];
  });
  if (format === "portable") return [["日期", "时间", "类型", "一级分类", "二级分类", "账户", "转入账户", "金额", "商户", "备注", "标签"], ...rows];
  if (format === "suishouji") return [["交易类型", "日期", "时间", "一级分类", "二级分类", "账户1", "账户2", "金额", "商家", "备注"], ...rows];
  if (format === "qianji") return [["日期", "类型", "分类", "账户", "金额", "商户", "备注"], ...rows];
  return [["日期", "类型", "账户", "转入账户", "分类", "金额", "商户", "备注", "标签"], ...rows];
}

async function exportData(token: string | null, format: ExportFormat, fileType: ExportFileType, accounts: Account[], categories: Category[], transactions: Transaction[]) {
  if (!token) return;
  const date = new Date().toISOString().slice(0, 10);
  const rows = localExportRows(format, accounts, categories, transactions);
  if (fileType === "xlsx") {
    await downloadXlsx(`ledger-${format}-${date}.xlsx`, rows);
    return;
  }
  const filename = `ledger-${format}-${date}.csv`;
  if (token.startsWith("local-preview:")) {
    downloadCsv(filename, rows);
    return;
  }
  const response = await fetch(api.exportUrl(format), { headers: authHeaders(token) });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
