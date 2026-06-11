import {
  activeOnly,
  centsToYuan,
  monthKey,
  summarizeMonth,
  yuanToCents,
  type Account,
  type Budget,
  type Category,
  type Transaction,
  type TransactionType
} from "@ledger/shared";
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
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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

function reportColor(index: number) {
  return REPORT_PALETTE[index % REPORT_PALETTE.length];
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
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function categoryUsageCounts(transactions: Transaction[], kind: Category["kind"]) {
  const counts = new Map<string, number>();
  transactions.forEach((item) => {
    if (item.type !== kind || !item.categoryId) return;
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  });
  return counts;
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

function isMealCategory(category: Category | undefined, categories: Category[]) {
  return /早餐|午餐|晚餐|早饭|午饭|晚饭|早午晚餐/.test(categoryPath(category, categories));
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
  const [view, setView] = useState<View>("overview");
  const [message, setMessage] = useState("准备同步");
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [quickCategoryOpen, setQuickCategoryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("ledger");
  const [exportFileType, setExportFileType] = useState<ExportFileType>("xlsx");

  const refreshLocal = useCallback(async () => {
    const [nextAccounts, nextCategories, nextTransactions, nextBudgets, nextOutboxCount, nextLastSync] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.orderBy("occurredAt").reverse().toArray(),
      db.budgets.toArray(),
      db.outbox.count(),
      db.meta.get("lastSyncAt")
    ]);
    setAccounts(nextAccounts);
    setCategories(nextCategories);
    setTransactions(nextTransactions);
    setBudgets(nextBudgets);
    setOutboxCount(nextOutboxCount);
    setLastSync(nextLastSync?.value);
  }, []);

  const activeAccounts = useMemo(() => activeOnly(accounts), [accounts]);
  const activeCategories = useMemo(() => activeOnly(categories), [categories]);
  const activeTransactions = useMemo(() => activeOnly(transactions), [transactions]);
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
  const currentBudgetCents = useMemo(() => monthBudgetTotal(activeOnly(budgets), currentMonth), [budgets, currentMonth]);

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
          (pending.budgets?.length ?? 0) >
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

  async function saveLocalAndQueue(kind: keyof Pick<typeof db, "accounts" | "categories" | "transactions" | "budgets">, item: Account | Category | Transaction | Budget) {
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
            <div className="app-heading-mark"><Banknote size={18} /></div>
            <div>
              <strong>消费账本</strong>
              <span>记录支出，分析现金流</span>
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
          <Reports transactions={activeTransactions} accounts={activeAccounts} categories={activeCategories} />
        )}
        {view === "settings" && (
          <SettingsPanel
            accounts={activeAccounts}
            categories={activeCategories}
            transactions={activeTransactions}
            budgets={activeOnly(budgets)}
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
        <button className="floating entry-fab" onClick={() => setView("entry")} title="记一笔"><Plus size={30} /></button>
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
  const recentTransactions = transactions.slice(0, 6);
  return (
    <section className="overview-dashboard">
      <div className="overview-hero">
        <div className="overview-hero-main">
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

      <div className="overview-kpis">
        <Metric title="本月消费" value={summary.expenseCents} icon={ArrowUpRight} tone="warn" />
        <Metric title="日均支出" value={dailyAverage} icon={ArrowUpRight} tone="warn" />
        <Metric title="最大单笔" value={largestExpense} icon={Banknote} tone="blue" />
      </div>

      <section className="panel overview-insight">
        <div>
          <span>最大支出分类</span>
          <strong>{topCategory ? categoryPath(topCategory, categories) : "暂无支出"}</strong>
        </div>
        <b>{topCategoryEntry ? `¥${centsToYuan(topCategoryEntry[1])}` : "¥0.00"}</b>
      </section>

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

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function EntryForm({ accounts, categories, transactions, onSave, onSaveCategory, editing, onCancel }: {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  onSave: (item: Transaction) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
  editing?: Transaction | null;
  onCancel?: () => void;
}) {
  const [type, setType] = useState<TransactionType>(editing?.type ?? "expense");
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(editing?.toAccountId ?? accounts[1]?.id ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [amount, setAmount] = useState(editing ? centsToYuan(editing.amountCents) : "");
  const [merchant, setMerchant] = useState(editing?.merchant ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [occurredAt, setOccurredAt] = useState(() => editing ? toDatetimeLocal(editing.occurredAt) : new Date().toISOString().slice(0, 16));
  const [saveFeedback, setSaveFeedback] = useState("");

  const categoryKind = type === "income" ? "income" : "expense";
  const usageCounts = useMemo(() => categoryUsageCounts(transactions, categoryKind), [transactions, categoryKind]);
  const filteredCategories = useMemo(
    () => sortCategoriesByUsage(selectableCategories(categories, categoryKind), categories, usageCounts),
    [categories, categoryKind, usageCounts]
  );
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const accountOptions = useMemo(() => quickEntryAccounts(accounts, type, editing), [accounts, type, editing]);
  const typeOptions: TransactionType[] = editing ? ["expense", "income", "transfer"] : ["expense", "income"];

  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setAccountId(editing.accountId);
    setToAccountId(editing.toAccountId ?? "");
    setCategoryId(editing.categoryId ?? "");
    setAmount(centsToYuan(editing.amountCents));
    setMerchant(editing.merchant ?? "");
    setNote(editing.note ?? "");
    setOccurredAt(toDatetimeLocal(editing.occurredAt));
  }, [editing]);

  useEffect(() => {
    if ((!accountId || !accountOptions.some((account) => account.id === accountId)) && accountOptions[0]) setAccountId(accountOptions[0].id);
    if (type !== "transfer" && !filteredCategories.some((category) => category.id === categoryId)) {
      setCategoryId(filteredCategories[0]?.id ?? "");
    }
  }, [accountOptions, filteredCategories, accountId, categoryId, type]);

  useEffect(() => {
    if (editing || type !== "expense" || !isMealCategory(selectedCategory, categories)) return;
    const mealAccount = mealDefaultAccount(accounts);
    if (mealAccount) setAccountId(mealAccount.id);
  }, [accounts, categories, editing, selectedCategory, type]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const item: Transaction = {
      ...(editing ?? entityStamp()),
      type,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      amountCents: yuanToCents(amount),
      occurredAt: new Date(occurredAt).toISOString(),
      merchant,
      note,
      tags: editing?.tags ?? [],
      version: editing ? editing.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };
    await onSave(item);
    if (!editing) {
      setAmount("");
      setMerchant("");
      setNote("");
      setOccurredAt(toDatetimeLocal(new Date().toISOString()));
      setSaveFeedback(`${typeLabels[type]} ¥${centsToYuan(item.amountCents)} 已保存`);
    }
  }

  return (
    <section className="panel entry-panel">
      <div className="entry-type-switch">
        {typeOptions.map((item) => (
          <button key={item} className={type === item ? "active" : ""} onClick={() => setType(item)} type="button">{typeLabels[item]}</button>
        ))}
      </div>
      <form className="form-grid" onSubmit={submit}>
        {saveFeedback && <div className="save-confirm full" role="status">{saveFeedback}</div>}
        <label>金额<input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" inputMode="decimal" required /></label>
        <label>{type === "income" ? "收款账户" : type === "expense" ? "信用卡" : "付款账户"}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {type === "transfer" ? (
          <label>转入账户<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{accounts.filter((item) => item.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        ) : (
          <CategoryPicker categories={categories} options={filteredCategories} usageCounts={usageCounts} kind={categoryKind} value={categoryId} onChange={setCategoryId} onCreate={onSaveCategory} />
        )}
        <div className="entry-actions full">
          <button className="primary">{editing ? "保存修改" : "保存流水"}</button>
          {editing && onCancel && <button type="button" className="ghost" onClick={onCancel}><X size={16} />取消编辑</button>}
        </div>
        <details className="entry-more full">
          <summary>时间、商户、备注</summary>
          <div className="entry-more-grid">
            <label>时间<input value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} type="datetime-local" /></label>
            <label>商户<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="超市、餐厅、客户..." /></label>
            <label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明" /></label>
          </div>
        </details>
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
  const normalizedQuery = query.trim().toLowerCase();
  const selectedCategory = options.find((category) => category.id === value);
  const matches = normalizedQuery
    ? options.filter((category) => categoryPath(category, categories).toLowerCase().includes(normalizedQuery))
    : [];
  const canCreate = query.trim().length > 0 && !options.some((category) => category.name.toLowerCase() === normalizedQuery);

  async function createQuickCategory() {
    const name = query.trim();
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
  }

  return (
    <label className="category-picker full">
      分类
      <select value={selectedCategory?.id ?? ""} onChange={(event) => onChange(event.target.value)} required>
        <option value="" disabled>选择分类</option>
        {options.map((category) => {
          const usage = usageCounts.get(category.id) ?? 0;
          return (
            <option key={category.id} value={category.id}>
              {categoryPath(category, categories)}{usage > 0 ? ` · 常用 ${usage}` : ""}
            </option>
          );
        })}
      </select>
      <div className="category-search">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索或新增分类" />
      </div>
      <div className="category-chip-list">
        {!normalizedQuery && selectedCategory && (
          <button type="button" className="category-chip active" onClick={() => onChange(selectedCategory.id)}>
            {categoryPath(selectedCategory, categories)}
          </button>
        )}
        {matches.map((category) => (
          <button type="button" className={value === category.id ? "category-chip active" : "category-chip"} key={category.id} onClick={() => onChange(category.id)}>
            {categoryPath(category, categories)}
          </button>
        ))}
        {canCreate && (
          <button type="button" className="category-chip create" onClick={() => void createQuickCategory()}>
            新增：其他 &gt; {query.trim()}
          </button>
        )}
      </div>
    </label>
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
                onDelete={onDelete}
                onEdit={onEdit}
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
    </section>
  );
}

function TransactionRows({ transactions, accounts, categories, onDelete, onEdit, onRestore, selectedIds, onToggleSelected, compact = false }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete?: (item: Transaction) => Promise<void>;
  onEdit?: (item: Transaction) => void;
  onRestore?: (item: Transaction) => Promise<void>;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  compact?: boolean;
}) {
  if (transactions.length === 0) return <p className="empty">暂无记录</p>;
  return (
    <div className="rows">
      {transactions.map((item) => {
        const account = accounts.find((entry) => entry.id === item.accountId);
        const category = categories.find((entry) => entry.id === item.categoryId);
        const sign = item.type === "expense" ? "-" : item.type === "income" ? "+" : "";
        const title = item.merchant || category?.name || typeLabels[item.type];
        const meta = `${new Date(item.occurredAt).toLocaleDateString()} · ${account?.name ?? ""}${category ? ` · ${category.name}` : ""}`;
        return (
          <article className={onToggleSelected ? "row selectable" : "row"} key={item.id}>
            {onToggleSelected && (
              <input
                aria-label="选择流水"
                checked={selectedIds?.has(item.id) ?? false}
                className="row-check"
                onChange={() => onToggleSelected(item.id)}
                type="checkbox"
              />
            )}
            <div className={`row-icon ${item.type}`}>{item.type === "transfer" ? <ArrowRightLeft size={15} /> : item.type === "income" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</div>
            <div className="row-main">
              <strong>{title}</strong>
              <span>{meta}</span>
            </div>
            <div className="row-side">
              <b>{sign}¥{centsToYuan(item.amountCents)}</b>
              {!compact && (
                <div className="row-actions">
                  {onEdit && <button className="icon-button mini" onClick={() => onEdit(item)} title="编辑"><Pencil size={14} /></button>}
                  {onDelete && <button className="icon-button mini" onClick={() => onDelete(item)} title="删除"><Trash2 size={14} /></button>}
                  {onRestore && <button className="icon-button mini" onClick={() => onRestore(item)} title="恢复"><Undo2 size={14} /></button>}
                </div>
              )}
            </div>
          </article>
        );
      })}
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

function Reports({ transactions, accounts, categories }: { transactions: Transaction[]; accounts: Account[]; categories: Category[] }) {
  const currentYear = String(new Date().getFullYear());
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [month, setMonth] = useState(monthKey());
  const [year, setYear] = useState(currentYear);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number | null>(null);
  const categoryKind: Category["kind"] = "expense";
  const selectedYear = year.trim() || currentYear;
  const periodKey = period === "month" ? month : selectedYear;
  const periodLabel = period === "month" ? monthLabel(month) : yearLabel(selectedYear);
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

  const trendData = Array.from({ length: period === "month" ? 12 : 6 }, (_, index) => {
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
  const maxTrend = Math.max(1, ...trendData.map((entry) => entry.expense));
  const recentExpenseAverage = Math.round(trendData.slice(-3).reduce((sum, item) => sum + item.expense, 0) / 3);

  useEffect(() => {
    if (selectedCategoryIndex !== null && selectedCategoryIndex > categoryData.length - 1) setSelectedCategoryIndex(null);
  }, [categoryData.length, selectedCategoryIndex]);

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

      <div className="report-metrics">
        <Metric title={period === "month" ? "日常月消费" : "日常年消费"} value={periodSummary.expenseCents} icon={ArrowUpRight} tone="warn" />
        <Metric title="专项支出" value={specialSummary.expenseCents} icon={Banknote} tone="blue" />
        <Metric title="预计日常消费" value={projectedExpense} icon={ArrowRightLeft} tone="neutral" />
      </div>

      <div className="finance-insights">
        <article className="insight-card">
          <span>最大支出项</span>
          <strong>{topExpense ? topExpense.name : "暂无"}</strong>
          <p>{topExpense ? `占本期支出的 ${topExpenseRatio}%，金额 ¥${centsToYuan(topExpense.value)}。` : "本期还没有支出数据。"}</p>
        </article>
        <article className={expenseChange > 15 ? "insight-card warn" : "insight-card neutral"}>
          <span>{period === "month" ? "日常支出环比" : "日常支出年比"}</span>
          <strong>{expenseChangeText}</strong>
          <p>参考历史导入数据中的上一个{period === "month" ? "月" : "年"}{isCurrentPeriod ? "同期" : ""}日常支出；负数表示本期下降。</p>
        </article>
        <article className="insight-card">
          <span>日均支出</span>
          <strong>¥{centsToYuan(dailyAverageExpense)}</strong>
          <p>{isCurrentPeriod ? `按当前节奏，本${period === "month" ? "月" : "年"}预计支出 ¥${centsToYuan(projectedExpense)}。` : `这是该${period === "month" ? "月" : "年"}实际日均支出。`}</p>
        </article>
        <article className={concentrationRatio > 65 ? "insight-card warn" : "insight-card neutral"}>
          <span>前三支出集中度</span>
          <strong>{concentrationRatio}%</strong>
          <p>{concentrationRatio > 65 ? "支出集中在少数分类，适合优先做专项控制。" : "支出结构相对分散。"}</p>
        </article>
        <article className={recentExpenseAverage > dailyAverageExpense * periodDays ? "insight-card warn" : "insight-card neutral"}>
          <span>{period === "month" ? "近三月平均消费" : "近三年平均消费"}</span>
          <strong>¥{centsToYuan(recentExpenseAverage)}</strong>
          <p>用长期均值对照当前支出，能更快发现异常月份和一次性大额消费。</p>
        </article>
        <article className={specialSummary.expenseCents > periodSummary.expenseCents ? "insight-card warn" : "insight-card neutral"}>
          <span>专项支出提醒</span>
          <strong>{specialTop ? specialTop.name : "暂无"}</strong>
          <p>{specialTop ? `本期专项最高为 ¥${centsToYuan(specialTop.value)}，不纳入正常消费趋势。` : "本期没有贷款、保险、教育或大额未分类专项支出。"}</p>
        </article>
      </div>

      {specialCategoryData.length > 0 && (
        <section className="panel special-expense-panel">
          <div className="chart-heading">
            <h2>专项支出</h2>
            <span>不纳入正常消费分析</span>
          </div>
          <div className="special-expense-grid">
            {specialCategoryData.map((entry) => (
              <div className="budget-line special-expense-line" key={entry.id}>
                <span>{entry.name}</span>
                <strong>¥{centsToYuan(entry.value)}</strong>
                <div className="bar"><i style={{ width: `${Math.max(3, Math.round((entry.value / Math.max(1, specialSummary.expenseCents)) * 100))}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid two report-grid">
        <div className="panel chart-panel category-analysis">
          <div className="chart-heading">
            <h2>分类统计</h2>
            <span>日常消费，含历史导入数据</span>
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
              <TransactionRows transactions={selectedCategoryTransactions.slice(0, 20)} accounts={accounts} categories={categories} compact />
              {selectedCategoryTransactions.length > 20 && <p className="empty">已显示最近 20 笔，更多明细可到流水页筛选查看。</p>}
            </div>
          )}
        </div>

        <div className="panel chart-panel trend-panel">
          <h2>{period === "month" ? "月度" : "年度"}消费趋势</h2>
          <div className="trend-legend">
            <span><i className="legend expense-bar" />支出</span>
          </div>
          <div className={`trend-bars monthly-flow ${period === "month" ? "monthly-trend" : "yearly-trend"}`}>
            {trendData.map((item) => {
              return (
                <div className="trend-month" key={item.period}>
                  <div className="trend-stack">
                    <i className="expense-bar" title={`支出 ¥${centsToYuan(item.expense)}`} style={{ height: `${Math.max(4, (item.expense / maxTrend) * 100)}%` }} />
                  </div>
                  <span>{period === "month" ? item.period.slice(5) : item.period}</span>
                  <small className="net-negative-text">{centsToYuan(item.expense)}</small>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </section>
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
