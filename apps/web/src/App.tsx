import {
  activeOnly,
  calculateAccountBalance,
  centsToYuan,
  isLiabilityAccount,
  monthKey,
  summarizeMonth,
  yuanToCents,
  type Account,
  type AnalysisNote,
  type Budget,
  type Category,
  type PlannedPurchase,
  type Transaction,
  type TransactionType
} from "@ledger/shared";
import "./styles.css";
import {
  Apple,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Baby,
  Backpack,
  Banknote,
  Beef,
  Bed,
  Beer,
  Bell,
  BellRing,
  Bike,
  Book,
  BookOpen,
  BottleWine,
  Briefcase,
  Bus,
  Cake,
  CalendarClock,
  Camera,
  Car,
  CarTaxiFront,
  Carrot,
  ChevronLeft,
  ChevronRight,
  Cigarette,
  Circle,
  Cloud,
  CloudOff,
  CloudRain,
  Coffee,
  Coins,
  Compass,
  Cookie,
  Crown,
  CreditCard,
  Database,
  Download,
  Drumstick,
  Droplets,
  Dumbbell,
  Egg,
  Film,
  Fish,
  Flame,
  Flower2,
  Folder,
  FolderPlus,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Globe,
  HandCoins,
  GraduationCap,
  HeartPulse,
  Headphones,
  Heart,
  Home,
  Info,
  Landmark,
  Laptop,
  Leaf,
  Lightbulb,
  ListFilter,
  LogOut,
  Luggage,
  Map as MapIcon,
  Martini,
  MessageCircle,
  Milk,
  Monitor,
  MoreHorizontal,
  Mountain,
  Music,
  Palmtree,
  PawPrint,
  Pencil,
  Phone,
  PieChartIcon,
  PiggyBank,
  Pill,
  PillBottle,
  Pizza,
  Plane,
  Plug,
  Plus,
  Popcorn,
  Popsicle,
  Receipt,
  Refrigerator,
  RefreshCw,
  RotateCcw,
  Sailboat,
  Scissors,
  Search,
  Settings2,
  Shirt,
  Ship,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sofa,
  Soup,
  Sparkles,
  Sprout,
  Store,
  Sun,
  Tag,
  Target,
  Ticket,
  TramFront,
  TrainFront,
  Trash2,
  TrendingDown,
  TrendingUp,
  TreePine,
  Tv,
  Umbrella,
  Undo2,
  Upload,
  Utensils,
  Wallet,
  WashingMachine,
  Wheat,
  Wifi,
  Wine,
  Wrench,
  X,
  Zap
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "./api";
import { getApiBase, setApiBase, getDefaultApiBase } from "./api";
import { clearOutbox, db, enqueue, readOutboxPayload, resetLocalData, saveSnapshot } from "./db";
import {
  aggregateCategoryExpenses,
  beijingDatetimeLocalToTimestamp,
  beijingDateTimeParts,
  budgetScope,
  categoryAggregateKey,
  categoryAggregateName,
  categoryBudgetCents,
  categoryPath,
  dailyExpenseTransactions,
  dateFromMonthKey,
  dateKey,
  dateLabel,
  dayOfYear,
  daysInMonth,
  daysInYear,
  monthBudgetTotal,
  monthLabel,
  monthTotalBudgetCents,
  markAllPurged,
  markPurged,
  offsetMonthKey,
  percentDelta,
  previousMonthKeys,
  shortMonthLabel,
  specialExpenseTransactions,
  toBeijingDatetimeLocal,
  toBeijingTransactionTimestamp,
  yearLabel
} from "./utils";
import {
  BigExpensePanel,
  BudgetReservoir,
  DailyLimitOverlay,
  DailyLimitRibbon,
  DailyPaceChart,
  FixedExpenseOverview,
  LocalDailyLimitAlertPanel,
  LocalSalaryReminderPanel,
  PlannedPurchasePanel,
  RegularExpensePanel,
  SalaryBanner,
  SearchView,
  TrendFocusCards,
  dailyLimitAlertTriggered,
  dailyLimitCents,
  dismissSalaryBannerForToday,
  InfoTip,
  loadDailyLimitAlertSettings,
  loadFixedExpenses,
  loadSalarySettings,
  maybeNotifyDailyLimit,
  maybeNotifyPayday,
  maybePraiseNoSpend,
  setPushSubscribed,
  salaryBannerDismissedKey,
  salaryBannerState,
  saveDailyLimitAlertSettings,
  saveSalarySettings,
  todayDailySpentCents,
  todayAllSpentCents,
  type DailyLimitAlertSettings,
  type SalarySettings
} from "./widgets";
import { PlanView } from "./plan";

type View = "overview" | "entry" | "transactions" | "reports" | "plan" | "search" | "settings";
type LedgerGroupMode = "day" | "month" | "year";
type ReportPeriod = "month" | "year";
type ExportFormat = "ledger" | "portable" | "suishouji" | "qianji";
type ExportFileType = "csv" | "xlsx";

/** 二级/三级子模块（设置、报表、总览里点进来的页面）：用导航栈管理，顶栏「返回」出栈 */
type SubView =
  | { kind: "trash" }
  | { kind: "data" }
  | { kind: "accounts" }
  | { kind: "accountEditor"; account: Account | null }
  | { kind: "categories" }
  | { kind: "categoryList"; categoryKind: Category["kind"] }
  | { kind: "categoryEditor"; category: Category | null; categoryKind: Category["kind"] }
  | { kind: "budgets" }
  | { kind: "budgetEditor"; budget: Budget | null }
  | { kind: "reminders" }
  | { kind: "reminderDetail"; which: "salary" | "dailyLimit" }
  | { kind: "fixedExpenses" }
  | { kind: "planBuy" }
  | { kind: "about" };

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "overview", label: "总览", icon: Home },
  { id: "transactions", label: "流水", icon: ListFilter },
  { id: "search", label: "搜索", icon: Search },
  { id: "reports", label: "报表", icon: PieChartIcon },
  { id: "plan", label: "规划", icon: CalendarClock },
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

function reportColor(index: number) {
  return REPORT_PALETTE[index % REPORT_PALETTE.length];
}

function trendColor(index: number) {
  return TREND_PALETTE[index % TREND_PALETTE.length];
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

const viewHeadingMap: Record<View, { strong: string; span: string; icon: typeof Home }> = {
  overview: { strong: "本月概览", span: "额度水位、消费趋势一览", icon: Home },
  entry: { strong: "快速记账", span: "日常消费、收入、转账", icon: Plus },
  transactions: { strong: "流水明细", span: "搜索、筛选、批量管理", icon: ListFilter },
  search: { strong: "搜索记录", span: "关键词检索，按月/年汇总", icon: Search },
  reports: { strong: "消费分析", span: "趋势、预算、支出结构", icon: PieChartIcon },
  plan: { strong: "支出规划", span: "未来消费与总支出预测（去年同期为主）", icon: CalendarClock },
  settings: { strong: "账户设置", span: "账户、分类、预算、数据", icon: Settings2 }
};

/** 二级/三级子模块的标题区（顶栏 app-heading 用） */
function subHeading(sub: SubView): { strong: string; span: string; icon: typeof Home } {
  switch (sub.kind) {
    case "trash":
      return { strong: "回收站", span: "已删除流水可恢复", icon: Undo2 };
    case "data":
      return { strong: "数据管理", span: "导出、导入与数据同步", icon: Database };
    case "accounts":
      return { strong: "账户管理", span: "账户、额度与资产总览", icon: Wallet };
    case "accountEditor":
      return { strong: sub.account ? "编辑账户" : "新增账户", span: "名称、类型与额度", icon: Pencil };
    case "categories":
      return { strong: "分类标签", span: "按支出、收入分类维护", icon: Tag };
    case "categoryList":
      return { strong: sub.categoryKind === "expense" ? "支出分类" : "收入分类", span: "点分类可编辑", icon: Tag };
    case "categoryEditor":
      return { strong: sub.category ? "编辑分类" : "新增分类", span: "名称与所属分类", icon: Pencil };
    case "budgets":
      return { strong: "预算管理", span: "日常消费与总开支两层预算", icon: Target };
    case "budgetEditor":
      return { strong: sub.budget ? "编辑预算" : "新增预算", span: "月份、类型与金额", icon: Pencil };
    case "reminders":
      return { strong: "提醒设置", span: "工资日与当日限额", icon: Bell };
    case "reminderDetail":
      return {
        strong: sub.which === "salary" ? "工资日提醒" : "当日限额提醒",
        span: sub.which === "salary" ? "纯本地提醒，离线也能用" : "达线警告与手机推送",
        icon: BellRing
      };
    case "fixedExpenses":
      return { strong: "本月固定支出", span: "固定项维护与最低固定支出测算", icon: Home };
    case "planBuy":
      return { strong: "计划购买", span: "想买清单，预算够时提醒", icon: ShoppingBag };
    case "about":
      return { strong: "关于与更新", span: "版本与更新检查", icon: Info };
  }
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
  // 二级/三级子模块导航栈：设置/报表里点进来的页面都压栈，顶栏「返回」出栈
  const [subStack, setSubStack] = useState<SubView[]>([]);
  const [message, setMessage] = useState("准备同步");
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [analysisNotes, setAnalysisNotes] = useState<AnalysisNote[]>([]);
  const [plannedPurchases, setPlannedPurchases] = useState<PlannedPurchase[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [entryFocusSignal, setEntryFocusSignal] = useState(0);
  const [quickCategoryOpen, setQuickCategoryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("ledger");
  const [exportFileType, setExportFileType] = useState<ExportFileType>("xlsx");
  const [salarySettings, setSalarySettings] = useState<SalarySettings>(() => loadSalarySettings());
  const [salaryDismissed, setSalaryDismissed] = useState<string | null>(() => salaryBannerDismissedKey());
  const [dailyLimitSettings, setDailyLimitSettings] = useState<DailyLimitAlertSettings>(() => loadDailyLimitAlertSettings());
  // 当日限额红色警报：一旦超限，当天每次打开 App 都会再次弹出；仅在本次会话内可关闭
  const [dailyLimitOverlayClosed, setDailyLimitOverlayClosed] = useState(false);

  const refreshLocal = useCallback(async () => {
    const [nextAccounts, nextCategories, nextTransactions, nextBudgets, nextAnalysisNotes, nextPlannedPurchases, nextOutboxCount, nextLastSync] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.orderBy("occurredAt").reverse().toArray(),
      db.budgets.toArray(),
      db.analysisNotes.toArray(),
      db.plannedPurchases.toArray(),
      db.outbox.count(),
      db.meta.get("lastSyncAt")
    ]);
    setAccounts(nextAccounts);
    setCategories(nextCategories);
    setTransactions(nextTransactions);
    setBudgets(nextBudgets);
    setAnalysisNotes(nextAnalysisNotes);
    setPlannedPurchases(nextPlannedPurchases);
    setOutboxCount(nextOutboxCount);
    setLastSync(nextLastSync?.value);
  }, []);

  const activeAccounts = useMemo(() => activeOnly(accounts), [accounts]);
  const activeCategories = useMemo(() => activeOnly(categories), [categories]);
  const activeTransactions = useMemo(() => activeOnly(transactions), [transactions]);
  const deletedTransactions = useMemo(() => transactions.filter((item) => item.deletedAt), [transactions]);
  const activeBudgets = useMemo(() => activeOnly(budgets), [budgets]);
  const activeAnalysisNotes = useMemo(() => activeOnly(analysisNotes), [analysisNotes]);
  const activePlannedPurchases = useMemo(() => activeOnly(plannedPurchases), [plannedPurchases]);
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
  const currentTotalBudgetCents = useMemo(() => monthTotalBudgetCents(activeBudgets, currentMonth), [activeBudgets, currentMonth]);
  const salaryBanner = useMemo(() => salaryBannerState(salarySettings, salaryDismissed), [salarySettings, salaryDismissed]);
  const todaySpentCents = useMemo(
    () => todayDailySpentCents(activeTransactions, activeCategories),
    [activeTransactions, activeCategories]
  );
  const todayAllSpentCentsValue = useMemo(
    () => todayAllSpentCents(activeTransactions, activeCategories),
    [activeTransactions, activeCategories]
  );
  const monthBudgetCents = useMemo(() => monthBudgetTotal(activeBudgets, currentMonth), [activeBudgets, currentMonth]);
  const todayLimitCents = useMemo(
    () => dailyLimitCents(activeBudgets, activeTransactions, activeCategories, currentMonth),
    [activeBudgets, activeTransactions, activeCategories, currentMonth]
  );
  const todayRemainingCents = monthBudgetCents > 0 ? todayLimitCents - todaySpentCents : null;
  const dailyLimitHit = dailyLimitAlertTriggered(dailyLimitSettings, todaySpentCents, todayLimitCents);
  const dailyLimitOver = dailyLimitHit && todaySpentCents > todayLimitCents;

  useEffect(() => {
    maybeNotifyPayday(salarySettings);
  }, [salarySettings]);

  useEffect(() => {
    maybeNotifyDailyLimit(dailyLimitSettings, todaySpentCents, todayLimitCents);
    maybePraiseNoSpend(dailyLimitSettings, todaySpentCents, todayLimitCents, todayAllSpentCentsValue);
  }, [dailyLimitSettings, todaySpentCents, todayLimitCents, todayAllSpentCentsValue]);

  // 应用一直开着也要能到点提醒：每 10 分钟重查一次
  useEffect(() => {
    const timer = window.setInterval(() => {
      maybeNotifyDailyLimit(dailyLimitSettings, todaySpentCents, todayLimitCents);
      maybePraiseNoSpend(dailyLimitSettings, todaySpentCents, todayLimitCents, todayAllSpentCentsValue);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [dailyLimitSettings, todaySpentCents, todayLimitCents, todayAllSpentCentsValue]);

  // 超限额时整个界面换深红警示皮肤（超支）或琥珀警示（刚好达线），关掉全屏遮罩后依然生效
  useEffect(() => {
    const body = document.body;
    body.classList.toggle("daily-limit-over", dailyLimitOver);
    body.classList.toggle("daily-limit-warn", dailyLimitHit && !dailyLimitOver);
    return () => {
      body.classList.remove("daily-limit-over", "daily-limit-warn");
    };
  }, [dailyLimitHit, dailyLimitOver]);

  /** 限额提醒设置同步到服务端：dailyLimitHour 固定 0（提醒时间功能已移除，达线即推）；离线时静默失败，本机设置仍生效 */
  const syncDailyLimitSettings = useCallback(async (next: DailyLimitAlertSettings) => {
    if (!token || isLocalPreview) return;
    try {
      await api.saveNotificationSettings(token, {
        dailyLimitEnabled: next.enabled,
        dailyLimitHour: 0,
        dailyLimitToleranceCents: next.toleranceCents,
        praiseEnabled: next.praiseEnabled
      });
    } catch {
      // 离线或服务端旧版本：忽略，本机提醒仍生效
    }
  }, [token, isLocalPreview]);

  // 启动时同步一次，确保服务端不按默认 21 点门控推送
  useEffect(() => {
    void syncDailyLimitSettings(dailyLimitSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 先把本机待同步队列推上去；队列为空返回 null。
   * 注意：判定依据必须是 outbox 行数，不能按 payload 长度算——否则只含「计划购买」的队列会被当成空队列，
   * 直接走 pull 把本地还没上传的数据用云端快照覆盖掉，队列也清不掉，表现为「怎么刷新都同步不了」。 */
  async function pushPending(nextToken = token) {
    if (!nextToken) return null;
    if ((await db.outbox.count()) === 0) return null;
    const pending = await readOutboxPayload();
    const pushed = await api.push(nextToken, pending);
    await clearOutbox();
    return pushed;
  }

  async function hydrateFromServer(nextToken = token) {
    if (!nextToken) return;
    if (nextToken.startsWith("local-preview:")) {
      await refreshLocal();
      setMessage("本地预览模式");
      return;
    }
    setBusy(true);
    try {
      // 启动时若本机还有没推上去的改动，先推再取，避免被云端快照覆盖
      const snapshot = (await pushPending(nextToken)) ?? (await api.bootstrap(nextToken));
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
      const pushed = await pushPending();
      const snapshot = pushed ?? (await api.pull(token));
      await saveSnapshot(snapshot);
      await refreshLocal();
      const doneAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setMessage(`同步完成 ${doneAt}`);
      setToast(pushed ? "同步完成（已上传本机改动）" : "同步完成");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setMessage(`同步失败：${detail}`);
      setToast(`同步失败：${detail}`);
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

  // 切换标签（尤其「流水」）时回到顶部：每次都从最新一条往下看，而不是沿用上个页面的滚动位置
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    syncKeyboardFlag();
  }, [view]);

  // 键盘弹出时给 body 打标记：隐藏底部导航/悬浮按钮、取消保存条的 sticky，
  // 避免这些固定元素被键盘顶起来盖住正在输入的字段，造成页面跳动。
  // 标记 = 输入框聚焦 或 软键盘在占屏（visualViewport 高度差）：
  // 仅靠焦点事件不可靠——聚焦中的输入框被卸载（保存后表单消失）不触发 blur，
  // iOS 上点保存按钮也未必让输入框失焦，都会让标记残留、底部菜单栏迟迟不恢复
  useEffect(() => {
    let blurTimer = 0;
    const sync = () => syncKeyboardFlag();
    const onFocusOut = (event: FocusEvent) => {
      // 焦点离开输入框后，若没有新的「会唤起软键盘」的元素接手（焦点去了按钮/正文/body，
      // relatedTarget 为 null 或 button 等），键盘必收起——乐观清除软键盘标记，不必等
      // visualViewport.resize 的异步回调（个别 WebView 不报 resize，会导致标记残留、菜单栏要
      // 用户再点一次屏幕才恢复）。isSoftKeyboardVisible 仅作为极个别漏报的兜底。
      const related = event.relatedTarget as Element | null;
      if (!isTypingElement(related)) {
        softKeyboardVisible = false;
        window.clearTimeout(blurTimer);
        blurTimer = window.setTimeout(sync, 60);
      } else {
        sync();
      }
    };
    const onViewportResize = () => {
      const wasVisible = softKeyboardVisible;
      softKeyboardVisible = isSoftKeyboardVisible();
      if (softKeyboardVisible) {
        sync();
      } else if (wasVisible) {
        // 键盘收起：稍等片刻再清标记，避开系统收起动画的中间态
        window.clearTimeout(blurTimer);
        blurTimer = window.setTimeout(sync, 80);
      }
    };
    const onVisibility = () => {
      if (document.hidden) return;
      softKeyboardVisible = isSoftKeyboardVisible();
      sync();
    };
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    softKeyboardVisible = isSoftKeyboardVisible();
    sync();
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      softKeyboardVisible = false;
      document.body.classList.remove("keyboard-open");
    };
  }, []);

  async function signOut() {
    localStorage.removeItem("ledger-token");
    localStorage.removeItem("ledger-user");
    setToken(null);
    setUserName("");
    await resetLocalData();
    await refreshLocal();
  }

  async function saveLocalAndQueue(
    kind: keyof Pick<typeof db, "accounts" | "categories" | "transactions" | "budgets" | "analysisNotes" | "plannedPurchases">,
    item: Account | Category | Transaction | Budget | AnalysisNote | PlannedPurchase
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

  /** 回收站「彻底删除」单笔：本地 Dexie 直接删行，outbox 打 purge 标记让服务端硬删除 */
  async function purgeTransaction(item: Transaction) {
    await db.transactions.delete(item.id);
    await enqueue({ transactions: [markPurged(item)] });
    await refreshLocal();
    if (!isLocalPreview && navigator.onLine) void syncNow();
    setToast("流水已彻底删除");
  }

  /** 清空回收站：批量删行 + 一条 purge 载荷推服务端 */
  async function clearTrash() {
    if (deletedTransactions.length === 0) return;
    await db.transactions.bulkDelete(deletedTransactions.map((item) => item.id));
    await enqueue({ transactions: markAllPurged(deletedTransactions) });
    await refreshLocal();
    if (!isLocalPreview && navigator.onLine) void syncNow();
    setToast(`回收站已清空（${deletedTransactions.length} 笔）`);
  }

  /* 计划购买（总览二级子模块）：增/改完成态/删/编辑，均走本地 + outbox 同步 */
  async function addPlannedPurchase(name: string, amountCents: number) {
    await saveLocalAndQueue("plannedPurchases", {
      id: crypto.randomUUID(),
      name,
      amountCents,
      note: null,
      completedAt: null,
      version: 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    setToast(`已加入计划购买：${name}`);
  }

  async function togglePlannedPurchase(item: PlannedPurchase) {
    const next = { ...item, completedAt: item.completedAt ? null : new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
    await saveLocalAndQueue("plannedPurchases", next);
    setToast(next.completedAt ? `已完成购买：${item.name}` : `已撤销完成：${item.name}`);
  }

  async function deletePlannedPurchase(item: PlannedPurchase) {
    const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
    await saveLocalAndQueue("plannedPurchases", deleted);
    setToast(`已删除：${item.name}`);
  }

  async function editPlannedPurchase(item: PlannedPurchase, name: string, amountCents: number) {
    const next = { ...item, name, amountCents, updatedAt: new Date().toISOString(), version: item.version + 1 };
    await saveLocalAndQueue("plannedPurchases", next);
    setToast(`已更新计划购买：${name}`);
  }

  const openEntry = useCallback(() => {
    setView("entry");
    setSubStack([]);
    setEntryFocusSignal((value) => value + 1);
  }, []);

  // 切换主视图时清空子模块栈；进入子模块用 pushSub
  const goView = useCallback((next: View) => {
    setView(next);
    setSubStack([]);
  }, []);
  const pushSub = useCallback((item: SubView) => setSubStack((current) => [...current, item]), []);
  const popSub = useCallback(() => setSubStack((current) => current.slice(0, -1)), []);
  const sub = subStack.length > 0 ? subStack[subStack.length - 1] : null;

  // 二级子模块：从左边缘右滑返回（iOS 风格）
  const subSwipe = useEdgeSwipeBack({ enabled: sub !== null, onBack: popSub });

  /** 二级/三级子模块渲染：设置与报表点进来的页面都走这里 */
  function renderSubView(current: SubView) {
    switch (current.kind) {
      case "trash":
        return (
          <Trash
            transactions={deletedTransactions}
            accounts={accounts}
            categories={categories}
            onRestore={async (item) => {
              const restored = { ...item, deletedAt: null, updatedAt: new Date().toISOString(), version: item.version + 1 };
              await saveLocalAndQueue("transactions", restored);
              setToast("流水已恢复");
            }}
            onPurge={(item) => purgeTransaction(item)}
            onClear={() => clearTrash()}
          />
        );
      case "data":
        return (
          <DataView
            accounts={activeAccounts}
            categories={activeCategories}
            transactions={activeTransactions}
            exportFormat={exportFormat}
            exportFileType={exportFileType}
            onExportFormatChange={setExportFormat}
            onExportFileTypeChange={setExportFileType}
            onExport={() => void exportData(token, exportFormat, exportFileType, activeAccounts, activeCategories, activeTransactions)}
            onImportFile={(file) => importCsv(file, activeAccounts, activeCategories, saveLocalAndQueue)}
            onImported={(count) => setToast(`已导入 ${count} 笔流水`)}
            onImportError={(error) => setToast(error instanceof Error ? error.message : "导入失败")}
          />
        );
      case "accounts":
        return (
          <AccountsView
            accounts={activeAccounts}
            transactions={activeTransactions}
            onOpenAccount={(account) => pushSub({ kind: "accountEditor", account })}
            onAddAccount={() => pushSub({ kind: "accountEditor", account: null })}
          />
        );
      case "accountEditor":
        return (
          <AccountEditorPage
            account={current.account}
            onSave={async (item) => {
              await saveLocalAndQueue("accounts", item);
              setToast("账户已保存");
            }}
            onDelete={async (item) => {
              const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
              await saveLocalAndQueue("accounts", deleted);
              setToast("账户已删除");
            }}
            onDone={popSub}
          />
        );
      case "categories":
        return (
          <CategoriesView
            categories={activeCategories}
            onOpenKind={(categoryKind) => pushSub({ kind: "categoryList", categoryKind })}
          />
        );
      case "categoryList":
        return (
          <CategoryListPage
            categories={activeCategories}
            categoryKind={current.categoryKind}
            onOpenCategory={(category) => pushSub({ kind: "categoryEditor", category, categoryKind: current.categoryKind })}
            onAddCategory={() => pushSub({ kind: "categoryEditor", category: null, categoryKind: current.categoryKind })}
          />
        );
      case "categoryEditor":
        return (
          <CategoryEditorPage
            category={current.category}
            categoryKind={current.categoryKind}
            categories={activeCategories}
            onSave={async (item) => {
              await saveLocalAndQueue("categories", item);
              setToast("分类已保存");
            }}
            onDelete={async (items) => {
              await saveManyLocalAndQueue("categories", items);
              setToast(items.length > 1 ? `已删除 ${items.length} 个分类` : "分类已删除");
            }}
            onDone={popSub}
          />
        );
      case "budgets":
        return (
          <BudgetsView
            budgets={activeBudgets}
            categories={activeCategories}
            transactions={activeTransactions}
            onOpenBudget={(budget) => pushSub({ kind: "budgetEditor", budget })}
            onAddBudget={() => pushSub({ kind: "budgetEditor", budget: null })}
          />
        );
      case "budgetEditor":
        return (
          <BudgetEditorPage
            budget={current.budget}
            budgets={activeBudgets}
            categories={activeCategories}
            onSave={async (item) => {
              await saveLocalAndQueue("budgets", item);
              setToast("预算已保存");
            }}
            onDelete={async (item) => {
              const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
              await saveLocalAndQueue("budgets", deleted);
              setToast("预算已删除");
            }}
            onDone={popSub}
          />
        );
      case "reminders":
        return (
          <RemindersView
            onOpen={(which) => pushSub({ kind: "reminderDetail", which })}
          />
        );
      case "reminderDetail":
        return (
          <ReminderDetailPage
            which={current.which}
            token={token ?? ""}
            salarySettings={salarySettings}
            onSalarySettingsChange={(next) => {
              setSalarySettings(next);
              saveSalarySettings(next);
              setSalaryDismissed(salaryBannerDismissedKey());
              setToast("工资日提醒设置已保存");
            }}
            dailyLimitSettings={dailyLimitSettings}
            onDailyLimitSettingsChange={(next) => {
              setDailyLimitSettings(next);
              saveDailyLimitAlertSettings(next);
              void syncDailyLimitSettings(next);
              setToast("当日限额提醒设置已保存");
            }}
            onToast={setToast}
          />
        );
      case "fixedExpenses":
        return (
          <section className="settings-stack">
            <FixedExpenseOverview transactions={activeTransactions} categories={activeCategories} />
          </section>
        );
      case "planBuy":
        return (
          <section className="settings-stack">
            <PlannedPurchasePanel
              items={activePlannedPurchases}
              todayRemainingCents={todayRemainingCents}
              onAdd={(name, amountCents) => void addPlannedPurchase(name, amountCents)}
              onToggleComplete={(item) => void togglePlannedPurchase(item)}
              onDelete={(item) => void deletePlannedPurchase(item)}
              onEdit={(item, name, amountCents) => void editPlannedPurchase(item, name, amountCents)}
            />
          </section>
        );
      case "about":
        return (
          <section className="settings-stack">
            <div className="settings-section data-section">
              <div className="data-section-head">
                <span className="settings-row-icon tone-green"><Info size={16} /></span>
                <span className="settings-row-text">
                  <strong>关于与更新</strong>
                  <small>当前应用版本（git 短 hash）与更新检查</small>
                </span>
              </div>
              <div className="settings-section-body">
                <AppVersionPanel onToast={setToast} />
              </div>
            </div>
          </section>
        );
      default:
        return null;
    }
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
              <button className={view === item.id && !sub ? "active" : ""} key={item.id} onClick={() => goView(item.id)} title={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sync-card">
          <span>{isLocalPreview ? "本地预览" : navigator.onLine ? "在线" : "离线"} · 待同步 {isLocalPreview ? 0 : outboxCount}</span>
          <small title={lastSync ? new Date(lastSync).toLocaleString() : undefined}>
            {message}{lastSync ? ` · ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </small>
          <button className="icon-button" onClick={syncNow} disabled={busy} title="立即同步">
            <RefreshCw size={18} className={busy ? "spin" : ""} />
          </button>
        </div>
        <button className="ghost danger" onClick={signOut}>
          <LogOut size={18} />
          退出
        </button>
      </aside>

      <main ref={subSwipe.ref as React.RefObject<HTMLElement>}>
        <EdgeBackHint x={subSwipe.hintX} />
        {dailyLimitHit && (
          <DailyLimitRibbon spentCents={todaySpentCents} limitCents={todayLimitCents} />
        )}
        <header className="topbar">
          <div className="page-heading">
            {sub && (
              <button type="button" className="back-button" onClick={popSub} title="返回上一级">
                <ChevronLeft size={16} />
                <span>返回</span>
              </button>
            )}
            <div className="page-heading-text">
              <span className="eyebrow">{currentMonth}</span>
              <h1>{sub ? subHeading(sub).strong : viewTitle(view)}</h1>
            </div>
          </div>
          <div className="app-heading">
            {!isLocalPreview && (
              <button
                type="button"
                className={`mobile-sync-bar${outboxCount > 0 || !navigator.onLine || busy ? " alert" : ""}`}
                onClick={syncNow}
                disabled={busy}
                title={`${userName || "未登录"} · ${navigator.onLine ? "在线" : "离线"} · 待同步 ${outboxCount} · 最后同步 ${lastSync ? new Date(lastSync).toLocaleString() : "从未"}（点击立即同步）`}
                aria-label="同步状态，点击立即同步"
              >
                <span className={`mobile-sync-dot ${navigator.onLine ? "online" : "offline"}`} />
                {(outboxCount > 0 || !navigator.onLine) && (
                  <span className="mobile-sync-count">{navigator.onLine ? (outboxCount > 99 ? "99+" : outboxCount) : "离线"}</span>
                )}
                {(outboxCount > 0 || busy) && <RefreshCw size={11} className={busy ? "spin" : ""} />}
              </button>
            )}
            <div className="app-heading-mark">{(() => { const heading = sub ? subHeading(sub) : viewHeadingMap[view]; const HeadingIcon = heading?.icon ?? Home; return <HeadingIcon size={18} />; })()}</div>
            <div>
              <strong>{sub ? subHeading(sub).strong : viewHeadingMap[view]?.strong ?? "总览"}</strong>
              <span>{sub ? subHeading(sub).span : viewHeadingMap[view]?.span ?? ""}</span>
            </div>
          </div>
        </header>

        {salaryBanner && (
          <SalaryBanner
            state={salaryBanner}
            onDismiss={() => {
              dismissSalaryBannerForToday();
              setSalaryDismissed(dateKey(new Date().toISOString()));
            }}
          />
        )}

        {sub ? (
          renderSubView(sub)
        ) : (
          <>
        {view === "overview" && (
          <Overview summary={dailySummary} budgetCents={currentBudgetCents} totalBudgetCents={currentTotalBudgetCents} categories={activeCategories} transactions={activeTransactions}
            plannedPurchases={activePlannedPurchases}
            onOpenFixedExpenses={() => pushSub({ kind: "fixedExpenses" })}
            onOpenPlanBuy={() => pushSub({ kind: "planBuy" })}
            todayLimitCents={todayLimitCents}
            todaySpentCents={todaySpentCents}
          />
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
        {view === "search" && (
          <SearchView transactions={activeTransactions} accounts={activeAccounts} categories={activeCategories} />
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
        {view === "plan" && (
          <PlanView
            transactions={activeTransactions}
            categories={activeCategories}
            budgets={activeBudgets}
          />
        )}
        {view === "settings" && (
          <SettingsPanel
            trashCount={deletedTransactions.length}
            onOpen={(item) => pushSub(item)}
            accountCount={activeAccounts.length}
            categoryCount={activeCategories.length}
            budgetCount={activeBudgets.length}
          />
        )}
          </>
        )}
        {dailyLimitHit && !dailyLimitOverlayClosed && (
          <DailyLimitOverlay
            spentCents={todaySpentCents}
            limitCents={todayLimitCents}
            toleranceCents={dailyLimitSettings.toleranceCents}
            onDismiss={() => setDailyLimitOverlayClosed(true)}
          />
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

function Overview({ summary, budgetCents, totalBudgetCents, categories, transactions, plannedPurchases, todayLimitCents, todaySpentCents, onOpenFixedExpenses, onOpenPlanBuy }: {
  summary: { incomeCents: number; expenseCents: number; netCents: number };
  budgetCents: number;
  totalBudgetCents: number;
  categories: Category[];
  transactions: Transaction[];
  plannedPurchases: PlannedPurchase[];
  todayLimitCents: number;
  todaySpentCents: number;
  /** 进入「本月固定支出」二级子模块 */
  onOpenFixedExpenses: () => void;
  /** 进入「计划购买」二级子模块 */
  onOpenPlanBuy: () => void;
}) {
  const monthTransactions = transactions.filter((item) => item.occurredAt.startsWith(monthKey()));
  const prevMonthKey = offsetMonthKey(monthKey(), -1);
  const prevMonthTransactions = transactions.filter((item) => item.occurredAt.startsWith(prevMonthKey));
  const prevMonthDailyExpenses = dailyExpenseTransactions(prevMonthTransactions, categories);
  const prevMonthExpenseCents = prevMonthDailyExpenses.reduce((sum, item) => sum + item.amountCents, 0);
  const prevMonthTotalExpenses = prevMonthTransactions.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amountCents, 0);
  const prevMonthElapsedDays = new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate();
  const prevMonthDailyAverage = prevMonthExpenseCents > 0 ? Math.round(prevMonthExpenseCents / prevMonthElapsedDays) : 0;
  const monthExpenseTransactionsAll = monthTransactions.filter((item) => item.type === "expense");
  const monthExpenseTransactions = dailyExpenseTransactions(monthTransactions, categories);
  const elapsedDays = Math.max(1, new Date().getDate());
  const dailyAverage = Math.round(summary.expenseCents / elapsedDays);
  const totalExpenseCents = monthExpenseTransactionsAll.reduce((sum, item) => sum + item.amountCents, 0);
  const totalExpenseDelta = percentDelta(totalExpenseCents, prevMonthTotalExpenses);
  const dailyAvgDelta = percentDelta(dailyAverage, prevMonthDailyAverage);
  const largestExpense = monthExpenseTransactions.reduce((max, item) => Math.max(max, item.amountCents), 0);
  const expenseByCategory = monthExpenseTransactions.reduce((totals, item) => {
    const id = item.categoryId ?? "uncategorized";
    totals.set(id, (totals.get(id) ?? 0) + item.amountCents);
    return totals;
  }, new Map<string, number>());
  const topCategoryEntry = Array.from(expenseByCategory.entries()).sort((left, right) => right[1] - left[1])[0];
  const topCategory = topCategoryEntry ? categories.find((category) => category.id === topCategoryEntry[0]) : undefined;
  // 两个二级子模块的入口摘要：固定支出读本机模板，计划购买取未完成项
  const fixedItems = loadFixedExpenses(monthKey());
  const fixedPredictedCents = fixedItems.reduce((sum, item) => sum + item.predictedCents, 0);
  const pendingPurchases = plannedPurchases.filter((item) => !item.completedAt);
  const pendingPurchaseCents = pendingPurchases.reduce((sum, item) => sum + item.amountCents, 0);
  const trendTag = (delta: number) => {
    if (delta === 0) return null;
    const isUp = delta > 0;
    const Icon = isUp ? TrendingUp : TrendingDown;
    return (
      <em className={`trend-tag ${isUp ? "trend-up" : "trend-down"}`}>
        <Icon size={11} strokeWidth={2.5} /> {isUp ? "+" : ""}{Math.abs(delta)}% 环比
      </em>
    );
  };
  return (
    <section className="overview-dashboard">
      <div className="reservoir-grid">
        <BudgetReservoir
          title="日常消费额度"
          note="不含贷款/保险/教育等专项"
          spentCents={summary.expenseCents}
          budgetCents={budgetCents}
          accent="#1f5f74"
          todayLimitCents={todayLimitCents}
          todaySpentCents={todaySpentCents}
        />
        <BudgetReservoir
          title="总开支额度"
          note="包含日常消费 + 专项支出"
          spentCents={totalExpenseCents}
          budgetCents={totalBudgetCents}
          accent="#31473a"
        />
      </div>

      <div className="settings-list overview-module-entries">
        <SubEntryRow
          icon={Home}
          tone="gold"
          title="本月固定支出"
          subtitle={`${monthLabel(monthKey())} · 预计 ¥${centsToYuan(fixedPredictedCents)} · 含最低固定支出测算`}
          count={fixedItems.length}
          onClick={onOpenFixedExpenses}
        />
        <SubEntryRow
          icon={ShoppingBag}
          tone="purple"
          title="计划购买"
          subtitle={pendingPurchases.length > 0 ? `待买 ${pendingPurchases.length} 项 · 合计 ¥${centsToYuan(pendingPurchaseCents)}` : "暂无想买的东西，点这里添加"}
          count={pendingPurchases.length}
          onClick={onOpenPlanBuy}
        />
      </div>

      <div className="overview-quick-grid">
        <article className="overview-quick-card">
          <span>本月总支出</span>
          <strong>¥{centsToYuan(totalExpenseCents)}</strong>
          {trendTag(totalExpenseDelta) ?? <em>日常 + 专项</em>}
        </article>
        <article className="overview-quick-card">
          <span>日均消费</span>
          <strong>¥{centsToYuan(dailyAverage)}</strong>
          {trendTag(dailyAvgDelta) ?? <em>按已过天数估算</em>}
        </article>
        <article className="overview-quick-card">
          <span>最大单笔</span>
          <strong>¥{centsToYuan(largestExpense)}</strong>
          <em>本月日常消费</em>
        </article>
        <article className="overview-quick-card category">
          <span>最大分类</span>
          <strong className="overview-quick-category">
            {topCategory && <CategoryIcon icon={topCategory.icon} size={14} />}
            {topCategory ? categoryPath(topCategory, categories) : "暂无支出"}
          </strong>
          <em>{topCategoryEntry ? `¥${centsToYuan(topCategoryEntry[1])}` : "¥0.00"}</em>
        </article>
      </div>
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

function triggerHaptic(pattern: VibratePattern = 8) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}

/**
 * iOS 风格「从左边缘向右滑动返回」：仅在启用（存在可返回的二级页）时挂监听。
 * - 起滑点必须在屏幕左边缘 EDGE 内，否则不接管（不干扰页面其它区域）。
 * - 手势须以横向右滑为主（dx > |dy|*RATIO）才 engage；纵向滚动则立即放弃、不 preventDefault，滚动照常。
 * - engage 后 preventDefault 阻止页面滚动，松手超过 THRESHOLD 才真正返回。
 * 视觉提示：左侧滑入的箭头（EdgeBackHint），随手指位移淡入。
 */
const EDGE_SWIPE = { EDGE: 32, START: 12, RATIO: 1.3, THRESHOLD: 72, MAX: 64 };
function useEdgeSwipeBack({ enabled, onBack }: { enabled: boolean; onBack: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const [hintX, setHintX] = useState(0);
  const stateRef = useRef({ startX: 0, startY: 0, engaged: false, dragX: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const { EDGE, START, RATIO, THRESHOLD, MAX } = EDGE_SWIPE;
    const reset = () => {
      const s = stateRef.current;
      s.engaged = false;
      s.dragX = 0;
      s.startX = 0;
      s.startY = 0;
      setHintX(0);
    };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || touch.clientX > EDGE) return;
      const s = stateRef.current;
      s.startX = touch.clientX;
      s.startY = touch.clientY;
      s.engaged = false;
      s.dragX = 0;
    };
    const onMove = (event: TouchEvent) => {
      const s = stateRef.current;
      if (s.startX === 0 && s.startY === 0) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - s.startX;
      const dy = touch.clientY - s.startY;
      if (!s.engaged) {
        if (dx > START && dx > Math.abs(dy) * RATIO) {
          s.engaged = true;
        } else if (Math.abs(dy) > START && Math.abs(dy) > Math.abs(dx)) {
          // 纵向滚动，放弃接管，让页面正常滚动
          s.startX = 0;
          s.startY = 0;
          return;
        } else {
          return;
        }
      }
      event.preventDefault();
      s.dragX = Math.max(0, dx);
      setHintX(Math.min(s.dragX, MAX));
    };
    const onEnd = () => {
      const s = stateRef.current;
      if (s.engaged && s.dragX >= THRESHOLD) onBackRef.current();
      reset();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      reset();
    };
  }, [enabled]);
  return { ref, hintX };
}

/** 左边缘右滑返回的视觉提示：随手指位移从左侧滑入的箭头 */
function EdgeBackHint({ x }: { x: number }) {
  const shown = Math.min(x, EDGE_SWIPE.MAX);
  return (
    <div
      className="edge-back-hint"
      style={{ opacity: Math.min(shown / EDGE_SWIPE.THRESHOLD, 1), transform: `translateX(${shown - EDGE_SWIPE.MAX - 8}px)` }}
      aria-hidden
    >
      <ChevronLeft size={26} />
    </div>
  );
}

// 会唤出系统软键盘的输入框（select/日期控件不算，它们弹的是系统选择器）
const NON_TYPING_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"]);

function isTypingElement(element: Element | null) {
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return false;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  return !NON_TYPING_INPUT_TYPES.has((element as HTMLInputElement).type);
}

function syncKeyboardFlag() {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("keyboard-open", isTypingElement(document.activeElement) || softKeyboardVisible);
}

// 软键盘当前是否在占屏（视觉视口比布局视口矮一截即键盘高度）。
// 焦点事件会漏报：聚焦中的输入框被直接从 DOM 移除（保存后表单卸载）不触发 blur，
// iOS 上点提交按钮也未必让输入框失焦；视口高度差是独立于焦点的第二信号，键盘真正收起时自动恢复。
let softKeyboardVisible = false;

function isSoftKeyboardVisible() {
  if (typeof window === "undefined" || !window.visualViewport) return false;
  // 只信移动端触屏：桌面窗口缩放/双指缩放不算键盘
  if (!window.matchMedia("(max-width: 940px) and (pointer: coarse)").matches) return false;
  return window.innerHeight - window.visualViewport.height > 120;
}

// 主动收起系统键盘：让当前聚焦元素失焦，触发 focusout 与键盘退场，
// 避免保存/取消后焦点元素被卸载导致 keyboard-open 标记残留
function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
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
  const clearAmount = useCallback(() => {
    setAmount("");
    const input = amountInputRef.current;
    if (input) input.focus();
  }, []);
  const prepareAmountOverwrite = useCallback(() => {
    if (!editing) return;
    window.setTimeout(() => {
      const input = amountInputRef.current;
      if (!input || document.activeElement !== input) return;
      input.select();
    }, 0);
  }, [editing]);
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
    // 先收起键盘再保存：iOS 上点保存按钮不保证让输入框失焦，
    // 编辑保存后整个表单随即卸载、焦点元素被移除同样不触发 blur，
    // 两种漏报都会让 keyboard-open 标记残留、底部菜单栏迟迟不恢复
    blurActiveElement();
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
      // 保存后不再自动重弹金额键盘（连记改由用户主动点金额框），让键盘收起、底部菜单栏立即恢复
    } else {
      // 编辑保存后表单随即卸载：兜底再同步一次键盘标记，
      // 覆盖个别 WebView 的 visualViewport 不报 resize 的情况
      window.setTimeout(syncKeyboardFlag, 350);
    }
  }

  // 卸载时若焦点还留在表单内（取消编辑/保存后表单消失），主动 blur：
  // 焦点元素被直接从 DOM 移除不会触发 focusout，键盘标记会残留
  useEffect(() => () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("form.entry-form-grid")) active.blur();
  }, []);

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
              <small>已加入流水，要再记一笔点金额框即可</small>
            </div>
          </div>
        )}
        <div className="entry-amount-field full">
          <span>金额</span>
          <input ref={amountInputRef} value={amount} aria-label="金额" onFocus={prepareAmountOverwrite} onClick={prepareAmountOverwrite} onChange={(event) => handleAmountChange(event.target.value)} placeholder="0.00" inputMode="decimal" enterKeyHint="done" autoComplete="off" autoFocus={!editing} required />
          {amount.trim() && <button type="button" className="entry-amount-clear" onClick={clearAmount} aria-label="清空金额" title="清空金额"><X size={14} /></button>}
        </div>
        <label className="entry-account-field">{type === "income" ? "收款账户" : type === "expense" ? "信用卡" : "付款账户"}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {type === "transfer" ? (
          <label>转入账户<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{accounts.filter((item) => item.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        ) : (
          <CategoryPicker categories={categories} options={filteredCategories} usageCounts={recentUsageCounts} kind={categoryKind} value={categoryId} onChange={setCategoryId} onCreate={onSaveCategory} />
        )}
        <label className="entry-note-field full">备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明（可选）" enterKeyHint="done" autoComplete="off" /></label>
        <details className="entry-more full">
          <summary>时间、商户</summary>
          <div className="entry-more-grid">
            <label className="entry-time-field">时间<input value={occurredAt} onChange={(event) => {
              setOccurredAt(event.target.value);
              setTimeTouched(true);
            }} type="datetime-local" /></label>
            <label>商户<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="超市、餐厅、客户..." /></label>
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
  }

  return (
    <div className="category-picker full">
      <div className="category-picker-head">
        <span className="field-label">分类</span>
        <small className="category-picker-count">共 {options.length} 个</small>
      </div>
      {(quickOptions.length > 0 || canCreate) && (
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
      )}
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
            enterKeyHint="search"
            autoComplete="off"
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
          <option value="" disabled>{normalizedQuery ? "选择搜索结果" : "全部分类"}</option>
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
        const rowClassName = `${onToggleSelected ? "row selectable" : "row"} ${interactive ? "interactive" : ""} row-type-${item.type}`.trim();
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

/** 设置页（一级）：工具卡 + 「基础功能」导航行，全部进入二级子模块 */
function SettingsPanel({
  trashCount,
  accountCount,
  categoryCount,
  budgetCount,
  onOpen
}: {
  trashCount: number;
  accountCount: number;
  categoryCount: number;
  budgetCount: number;
  onOpen: (item: SubView) => void;
}) {
  return (
    <section className="settings-stack">
      <div className="settings-tools-grid">
        <button type="button" className="settings-tool-card tone-danger" onClick={() => onOpen({ kind: "trash" })}>
          <span className="settings-tool-icon"><Trash2 size={18} /></span>
          <strong>流水回收站</strong>
          <small>可恢复历史删除流水</small>
          {trashCount > 0 && <span className="settings-tool-badge">{trashCount > 99 ? "99+" : trashCount}</span>}
        </button>
        <button type="button" className="settings-tool-card tone-teal" onClick={() => onOpen({ kind: "data" })}>
          <span className="settings-tool-icon"><Database size={18} /></span>
          <strong>数据管理</strong>
          <small>导出、导入与数据同步</small>
        </button>
      </div>

      <p className="settings-group-label">基础功能</p>

      <div className="settings-list">
        <SettingsRow icon={Wallet} tone="teal" title="账户管理" subtitle={`${accountCount} 个账户 · 额度与资产总览`} onClick={() => onOpen({ kind: "accounts" })} />
        <SettingsRow icon={Target} tone="purple" title="预算管理" subtitle={`${budgetCount} 项预算 · 日常消费与总开支`} onClick={() => onOpen({ kind: "budgets" })} />
        <SettingsRow icon={Tag} tone="green" title="分类标签" subtitle={`${categoryCount} 个分类 · 支出与收入`} onClick={() => onOpen({ kind: "categories" })} />
        <SettingsRow icon={Bell} tone="gold" title="提醒设置" subtitle="工资日、当日限额与手机推送" onClick={() => onOpen({ kind: "reminders" })} />
        <SettingsRow icon={Info} tone="green" title="关于与更新" subtitle="当前版本与更新检查" onClick={() => onOpen({ kind: "about" })} />
      </div>
    </section>
  );
}

/** 数据管理子模块（二级页）：数据导出 / 数据导入 / 数据同步 三个分区，顶栏「返回」回设置页 */
function DataView({
  accounts,
  categories,
  transactions,
  exportFormat,
  exportFileType,
  onExportFormatChange,
  onExportFileTypeChange,
  onExport,
  onImportFile,
  onImported,
  onImportError
}: {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  exportFormat: ExportFormat;
  exportFileType: ExportFileType;
  onExportFormatChange: (format: ExportFormat) => void;
  onExportFileTypeChange: (fileType: ExportFileType) => void;
  onExport: () => void;
  onImportFile: (file: File) => Promise<number>;
  onImported: (count: number) => void;
  onImportError: (error: unknown) => void;
}) {
  return (
    <section className="settings-stack">
      <div className="settings-section data-section">
        <div className="data-section-head">
          <span className="settings-row-icon tone-teal"><Download size={16} /></span>
          <span className="settings-row-text">
            <strong>数据导出</strong>
            <small>一键导出流水与报表数据</small>
          </span>
        </div>
        <div className="settings-section-body">
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
            </div>
            <div className="data-stat-strip">
              <span>{transactions.length} 笔流水</span>
              <span>{accounts.length} 个账户</span>
              <span>{categories.length} 个分类</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section data-section">
        <div className="data-section-head">
          <span className="settings-row-icon tone-green"><Upload size={16} /></span>
          <span className="settings-row-text">
            <strong>数据导入</strong>
            <small>支持支付宝、微信等账单</small>
          </span>
        </div>
        <div className="settings-section-body">
          <div className="form-stack data-tools-panel">
            <label className="primary import-button">
              <Upload size={17} />
              选择账单文件导入
              <input type="file" accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm,text/csv,text/tab-separated-values,text/plain,text/html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  void onImportFile(file).then(onImported).catch(onImportError);
                }
                event.currentTarget.value = "";
              }} />
            </label>
            <small className="sync-hint">支持 CSV / Excel 账单（支付宝、微信、随手记兼容格式等），导入的流水会进入正常流水列表。</small>
          </div>
        </div>
      </div>

      <div className="settings-section data-section">
        <div className="data-section-head">
          <span className="settings-row-icon tone-gold"><RefreshCw size={16} /></span>
          <span className="settings-row-text">
            <strong>数据同步</strong>
            <small>切换云端/本地同步地址</small>
          </span>
        </div>
        <div className="settings-section-body">
          <SyncSettingsPanel />
        </div>
      </div>
    </section>
  );
}

/* ============ 分类图标（消费分类图形标识，替代首汉字） ============ */

/** 分类图标库：icon 字符串 → 图形 + 中文标签（设置里点选，图表里渲染） */
const categoryIconMeta: Record<string, { label: string; icon: typeof Tag }> = {
  // —— 餐饮 / 食品酒水 ——
  utensils: { label: "餐饮", icon: Utensils },
  coffee: { label: "咖啡", icon: Coffee },
  soup: { label: "汤粥", icon: Soup },
  pizza: { label: "快餐", icon: Pizza },
  cake: { label: "蛋糕", icon: Cake },
  cookie: { label: "饼干", icon: Cookie },
  popcorn: { label: "零食", icon: Popcorn },
  popsicle: { label: "冰品", icon: Popsicle },
  apple: { label: "水果", icon: Apple },
  carrot: { label: "蔬菜", icon: Carrot },
  wheat: { label: "主食", icon: Wheat },
  beef: { label: "肉类", icon: Beef },
  drumstick: { label: "禽肉", icon: Drumstick },
  fish: { label: "海鲜", icon: Fish },
  egg: { label: "蛋奶", icon: Egg },
  milk: { label: "牛奶", icon: Milk },
  wine: { label: "酒水", icon: Wine },
  beer: { label: "啤酒", icon: Beer },
  martini: { label: "鸡尾酒", icon: Martini },
  "bottle-wine": { label: "红酒", icon: BottleWine },

  // —— 居家物业 ——
  "shopping-bag": { label: "超市", icon: ShoppingBag },
  "shopping-cart": { label: "网购", icon: ShoppingCart },
  "shopping-basket": { label: "菜场", icon: ShoppingBasket },
  home: { label: "居家", icon: Home },
  zap: { label: "电费", icon: Zap },
  droplets: { label: "水费", icon: Droplets },
  wifi: { label: "网费", icon: Wifi },
  plug: { label: "电器", icon: Plug },
  flame: { label: "燃气", icon: Flame },
  wrench: { label: "维修", icon: Wrench },
  sofa: { label: "家具", icon: Sofa },
  "washing-machine": { label: "家电", icon: WashingMachine },
  refrigerator: { label: "冰箱", icon: Refrigerator },
  lightbulb: { label: "灯泡", icon: Lightbulb },

  // —— 行车交通 ——
  bus: { label: "公交", icon: Bus },
  "train-front": { label: "火车", icon: TrainFront },
  "tram-front": { label: "地铁", icon: TramFront },
  car: { label: "用车", icon: Car },
  "car-taxi-front": { label: "出租", icon: CarTaxiFront },
  fuel: { label: "加油", icon: Fuel },
  bike: { label: "单车", icon: Bike },
  plane: { label: "飞机", icon: Plane },
  ship: { label: "轮船", icon: Ship },
  sailboat: { label: "游船", icon: Sailboat },
  luggage: { label: "行李", icon: Luggage },

  // —— 通讯 / 数码 ——
  smartphone: { label: "手机", icon: Smartphone },
  phone: { label: "话费", icon: Phone },
  laptop: { label: "电脑", icon: Laptop },
  monitor: { label: "显示器", icon: Monitor },
  tv: { label: "电视", icon: Tv },
  camera: { label: "相机", icon: Camera },

  // —— 娱乐 / 旅行 ——
  "gamepad-2": { label: "游戏", icon: Gamepad2 },
  film: { label: "电影", icon: Film },
  music: { label: "音乐", icon: Music },
  headphones: { label: "听书", icon: Headphones },
  ticket: { label: "演出", icon: Ticket },
  crown: { label: "会员", icon: Crown },
  sparkles: { label: "娱乐", icon: Sparkles },
  gem: { label: "收藏", icon: Gem },
  map: { label: "旅游", icon: MapIcon },
  palmtree: { label: "度假", icon: Palmtree },
  compass: { label: "户外", icon: Compass },
  mountain: { label: "登山", icon: Mountain },
  globe: { label: "签证", icon: Globe },
  bed: { label: "酒店", icon: Bed },

  // —— 母婴 / 宠物 ——
  baby: { label: "育儿", icon: Baby },
  heart: { label: "母婴", icon: Heart },
  "paw-print": { label: "宠物", icon: PawPrint },

  // —— 医疗 / 教育 ——
  "heart-pulse": { label: "医疗", icon: HeartPulse },
  pill: { label: "药品", icon: Pill },
  "pill-bottle": { label: "保健", icon: PillBottle },
  "book-open": { label: "书籍", icon: BookOpen },
  book: { label: "文具", icon: Book },
  "graduation-cap": { label: "学费", icon: GraduationCap },
  pencil: { label: "学习", icon: Pencil },

  // —— 金融 ——
  coins: { label: "理财", icon: Coins },
  "piggy-bank": { label: "储蓄", icon: PiggyBank },
  wallet: { label: "钱包", icon: Wallet },
  banknote: { label: "现金", icon: Banknote },
  landmark: { label: "银行", icon: Landmark },
  "hand-coins": { label: "红包", icon: HandCoins },
  "trending-up": { label: "股票", icon: TrendingUp },
  gift: { label: "礼金", icon: Gift },

  // —— 服饰 / 箱包 ——
  shirt: { label: "服饰", icon: Shirt },
  backpack: { label: "箱包", icon: Backpack },

  // —— 生活杂项 ——
  briefcase: { label: "办公", icon: Briefcase },
  receipt: { label: "票据", icon: Receipt },
  store: { label: "商户", icon: Store },
  umbrella: { label: "雨具", icon: Umbrella },
  sun: { label: "防晒", icon: Sun },
  "cloud-rain": { label: "天气", icon: CloudRain },
  "flower-2": { label: "鲜花", icon: Flower2 },
  leaf: { label: "绿植", icon: Leaf },
  sprout: { label: "盆栽", icon: Sprout },
  "tree-pine": { label: "养护", icon: TreePine },
  dumbbell: { label: "健身", icon: Dumbbell },
  cigarette: { label: "香烟", icon: Cigarette },
  scissors: { label: "理发", icon: Scissors },

  // —— 兜底 ——
  folder: { label: "其他", icon: Folder },
  tag: { label: "标签", icon: Tag },
  circle: { label: "默认", icon: Circle }
};

/** 渲染分类图标：按 category.icon 取图形，未登记/缺省回退默认圆点 */
function CategoryIcon({ icon, size = 16 }: { icon?: string | null; size?: number }) {
  const entry = (icon && categoryIconMeta[icon]) || categoryIconMeta.circle;
  const Icon = entry.icon;
  return <Icon size={size} />;
}

/* ============ 二级/三级子模块：账户管理 ============ */

const accountTypeMeta: Record<Account["type"], { label: string; group: string; icon: typeof Wallet; color: string }> = {
  cash: { label: "现金", group: "现金账户", icon: Banknote, color: "#c9873a" },
  bank: { label: "银行卡", group: "储蓄账户", icon: Landmark, color: "#1f5f74" },
  alipay: { label: "支付宝", group: "虚拟账户", icon: Smartphone, color: "#1769aa" },
  wechat: { label: "微信", group: "虚拟账户", icon: MessageCircle, color: "#24834f" },
  credit: { label: "信用卡", group: "信用账户", icon: CreditCard, color: "#b84531" },
  investment: { label: "投资", group: "投资账户", icon: TrendingUp, color: "#6b6f3f" },
  loan: { label: "贷款/债务", group: "负债账户", icon: PiggyBank, color: "#8a5fb0" },
  other: { label: "其他", group: "其他账户", icon: Wallet, color: "#8a7154" }
};

const accountGroupOrder: Account["type"][] = ["cash", "bank", "alipay", "wechat", "credit", "investment", "loan", "other"];

/** 账户管理（二级页）：净资产总览 + 按类型分组的账户行（图标 + 名称 + 余额） */
function AccountsView({ accounts, transactions, onOpenAccount, onAddAccount }: {
  accounts: Account[];
  transactions: Transaction[];
  onOpenAccount: (account: Account) => void;
  onAddAccount: () => void;
}) {
  const rows = accounts.map((account) => ({
    account,
    balance: calculateAccountBalance(account, transactions),
    meta: accountTypeMeta[account.type] ?? accountTypeMeta.other
  }));
  const assetCents = rows.filter((row) => !isLiabilityAccount(row.account)).reduce((sum, row) => sum + row.balance, 0);
  const liabilityCents = rows.filter((row) => isLiabilityAccount(row.account)).reduce((sum, row) => sum + Math.abs(row.balance), 0);
  const netWorthCents = assetCents - liabilityCents;
  const groups = accountGroupOrder
    .map((type) => ({ type, meta: accountTypeMeta[type], items: rows.filter((row) => row.account.type === type) }))
    .filter((group) => group.items.length > 0);

  return (
    <section className="settings-stack">
      <div className="panel asset-summary">
        <div className="asset-summary-main">
          <span>净资产</span>
          <strong>¥{centsToYuan(netWorthCents)}</strong>
        </div>
        <div className="asset-summary-side">
          <span>总资产 ¥{centsToYuan(assetCents)}</span>
          <em>总负债 ¥{centsToYuan(liabilityCents)}</em>
        </div>
      </div>
      {groups.map((group) => (
        <div className="settings-section account-group" key={group.type}>
          <div className="account-group-head">
            <span>{group.meta.group}</span>
            <small>{group.items.length} 个</small>
          </div>
          <div className="account-group-rows">
            {group.items.map(({ account, balance, meta }) => {
              const Icon = meta.icon;
              return (
                <button type="button" className="account-row" key={account.id} onClick={() => onOpenAccount(account)}>
                  <span className="account-row-icon" style={{ background: `${meta.color}1f`, color: meta.color }}><Icon size={17} /></span>
                  <span className="account-row-text">
                    <strong>{account.name}</strong>
                    <small>{meta.label}{account.openingBalanceCents ? ` · 额度 ¥${centsToYuan(Math.abs(account.openingBalanceCents))}` : ""}</small>
                  </span>
                  <span className="account-row-amount">¥{centsToYuan(balance)}</span>
                  <ChevronRight size={15} className="settings-row-chevron" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {accounts.length === 0 && <p className="empty">还没有账户，点下方「新增账户」添加一个吧。</p>}
      <button type="button" className="primary add-entry-button" onClick={onAddAccount}><Plus size={16} />新增账户</button>
    </section>
  );
}

/** 账户编辑/新增（三级页） */
function AccountEditorPage({ account, onSave, onDelete, onDone }: {
  account: Account | null;
  onSave: (item: Account) => Promise<void>;
  onDelete: (item: Account) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<Account["type"]>(account?.type ?? "bank");
  const [color, setColor] = useState(account?.color ?? accountTypeMeta.bank.color);
  const [limit, setLimit] = useState(account?.openingBalanceCents ? centsToYuan(Math.abs(account.openingBalanceCents)) : "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    blurActiveElement();
    await onSave({
      ...(account ?? entityStamp()),
      name: name.trim(),
      type,
      color,
      openingBalanceCents: limit ? yuanToCents(limit) : 0,
      version: account ? account.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    onDone();
  }

  async function remove() {
    if (!account) return;
    if (!window.confirm(`删除账户“${account.name}”？历史流水会保留，只是不再作为可选账户显示。`)) return;
    blurActiveElement();
    await onDelete(account);
    onDone();
  }

  return (
    <section className="settings-stack">
      <form className="panel form-stack editor-page" onSubmit={submit}>
        <label>账户名称
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="账户名称" required autoFocus={!account} />
        </label>
        <label>账户类型</label>
        <div className="type-picker">
          {accountGroupOrder.map((item) => {
            const meta = accountTypeMeta[item];
            const Icon = meta.icon;
            return (
              <button
                type="button"
                key={item}
                className={type === item ? "type-option active" : "type-option"}
                style={type === item ? { borderColor: meta.color, color: meta.color, background: `${meta.color}14` } : undefined}
                onClick={() => {
                  setType(item);
                  setColor(meta.color);
                }}
              >
                <Icon size={15} />
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>
        <label>额度 / 初始余额（可选）
          <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="0.00" inputMode="decimal" />
        </label>
        <label>标识颜色
          <input value={color} onChange={(event) => setColor(event.target.value)} type="color" />
        </label>
        <button className="primary" type="submit">保存账户</button>
        {account && (
          <button type="button" className="ghost danger" onClick={() => void remove()}><Trash2 size={15} />删除账户</button>
        )}
      </form>
    </section>
  );
}

/* ============ 二级/三级子模块：分类标签 ============ */

/** 二级入口行（图标 + 标题 + 副标题 + 数量 + chevron） */
function SubEntryRow({ icon: Icon, tone, title, subtitle, count, onClick }: {
  icon: typeof Wallet;
  tone: "danger" | "teal" | "green" | "gold" | "purple";
  title: string;
  subtitle: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-section sub-entry-row" onClick={onClick}>
      <span className="settings-row-head">
        <span className={`settings-row-icon tone-${tone} sub-entry-icon`}><Icon size={19} /></span>
        <span className="settings-row-text">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        {count !== undefined && <span className="sub-entry-count">{count}</span>}
        <ChevronRight size={16} className="settings-row-chevron" />
      </span>
    </button>
  );
}

/** 分类标签（二级页）：支出分类 / 收入分类 两个入口 */
function CategoriesView({ categories, onOpenKind }: {
  categories: Category[];
  onOpenKind: (categoryKind: Category["kind"]) => void;
}) {
  const expenseCount = categories.filter((item) => item.kind === "expense").length;
  const incomeCount = categories.filter((item) => item.kind === "income").length;
  return (
    <section className="settings-stack">
      <div className="settings-list">
        <SubEntryRow
          icon={ArrowUpRight}
          tone="danger"
          title="支出分类"
          subtitle="查看支出分类统计，或自定义支出分类"
          count={expenseCount}
          onClick={() => onOpenKind("expense")}
        />
        <SubEntryRow
          icon={ArrowDownLeft}
          tone="green"
          title="收入分类"
          subtitle="查看收入分类统计，或自定义收入分类"
          count={incomeCount}
          onClick={() => onOpenKind("income")}
        />
      </div>
    </section>
  );
}

/** 分类列表（三级页）：一级分类 + 二级分类，全部带彩色图标砖 */
function CategoryListPage({ categories, categoryKind, onOpenCategory, onAddCategory }: {
  categories: Category[];
  categoryKind: Category["kind"];
  onOpenCategory: (category: Category) => void;
  onAddCategory: () => void;
}) {
  const list = categories.filter((item) => item.kind === categoryKind);
  const parents = list.filter((item) => !item.parentId);
  const childrenOf = (id: string) => list.filter((item) => item.parentId === id);

  return (
    <section className="settings-stack">
      <div className="settings-section account-group">
        <div className="account-group-head">
          <span>{categoryKind === "expense" ? "支出分类" : "收入分类"}</span>
          <small>{list.length} 个</small>
        </div>
        <div className="account-group-rows">
          {parents.length === 0 && <p className="empty">还没有分类，点下方「新增分类」添加一个吧。</p>}
          {parents.map((parent) => {
            const children = childrenOf(parent.id);
            return (
              <Fragment key={parent.id}>
                <button type="button" className="account-row category-row" onClick={() => onOpenCategory(parent)}>
                  <span className="account-row-icon" style={{ background: `${parent.color}1f`, color: parent.color }}><CategoryIcon icon={parent.icon} size={16} /></span>
                  <span className="account-row-text">
                    <strong>{parent.name}</strong>
                    <small>{children.length} 个子分类</small>
                  </span>
                  <ChevronRight size={15} className="settings-row-chevron" />
                </button>
                {children.map((child) => (
                  <button type="button" className="account-row category-row child" key={child.id} onClick={() => onOpenCategory(child)}>
                    <span className="account-row-icon" style={{ background: `${child.color}1f`, color: child.color }}><CategoryIcon icon={child.icon} size={14} /></span>
                    <span className="account-row-text">
                      <strong>{child.name}</strong>
                      <small>{parent.name}</small>
                    </span>
                    <ChevronRight size={15} className="settings-row-chevron" />
                  </button>
                ))}
              </Fragment>
            );
          })}
        </div>
      </div>
      <button type="button" className="primary add-entry-button" onClick={onAddCategory}><Plus size={16} />新增分类</button>
    </section>
  );
}

/** 分类编辑/新增（四级页） */
function CategoryEditorPage({ category, categoryKind, categories, onSave, onDelete, onDone }: {
  category: Category | null;
  categoryKind: Category["kind"];
  categories: Category[];
  onSave: (item: Category) => Promise<void>;
  onDelete: (items: Category[]) => Promise<void>;
  onDone: () => void;
}) {
  const activeCategories = activeOnly(categories);
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<Category["kind"]>(category?.kind ?? categoryKind);
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "circle");
  const topCategories = activeCategories.filter((item) => !item.parentId && item.kind === kind && item.id !== category?.id);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    blurActiveElement();
    let nextParentId: string | null = parentId || null;
    if (!category && !nextParentId) {
      // 新分类默认放进「其他」
      let parent = otherCategory(activeCategories, kind);
      if (!parent) {
        parent = makeCategory({ name: "其他", kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
        await onSave(parent);
      }
      nextParentId = parent.id;
    }
    await onSave({
      ...(category ?? makeCategory({ name, kind, parentId: nextParentId })),
      name: name.trim(),
      kind,
      parentId: nextParentId,
      icon,
      version: category ? category.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    onDone();
  }

  async function remove() {
    if (!category) return;
    const children = activeCategories.filter((item) => item.parentId === category.id);
    const message = children.length > 0
      ? `删除“${category.name}”及 ${children.length} 个子分类？历史流水会保留。`
      : `删除分类“${category.name}”？历史流水会保留。`;
    if (!window.confirm(message)) return;
    blurActiveElement();
    const now = new Date().toISOString();
    await onDelete([category, ...children].map((item) => ({
      ...item,
      deletedAt: now,
      updatedAt: now,
      version: item.version + 1
    })));
    onDone();
  }

  return (
    <section className="settings-stack">
      <form className="panel form-stack editor-page" onSubmit={submit}>
        <label>分类名称
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="分类名称" required autoFocus={!category} />
        </label>
        <label>分类方向
          <select value={kind} onChange={(event) => setKind(event.target.value as Category["kind"])}>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </label>
        <label>所属分类
          <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">作为一级分类</option>
            {topCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="category-icon-field">
          <span className="field-label">分类图标</span>
          <div className="category-icon-picker">
            {Object.entries(categoryIconMeta).map(([id, entry]) => {
              const OptionIcon = entry.icon;
              const selected = icon === id;
              return (
                <button
                  type="button"
                  key={id}
                  className={`category-icon-option ${selected ? "selected" : ""}`.trim()}
                  style={selected ? { borderColor: kind === "expense" ? "#d45b3f" : "#2f7d4f", color: kind === "expense" ? "#d45b3f" : "#2f7d4f" } : undefined}
                  onClick={() => setIcon(id)}
                  title={entry.label}
                  aria-label={entry.label}
                  aria-pressed={selected}
                >
                  <OptionIcon size={17} />
                </button>
              );
            })}
          </div>
          <small className="category-icon-hint">图表与列表按图标显示，不再用名称首字</small>
        </div>
        <button className="primary" type="submit">保存分类</button>
        {category && (
          <button type="button" className="ghost danger" onClick={() => void remove()}><Trash2 size={15} />删除分类</button>
        )}
      </form>
    </section>
  );
}

/* ============ 二级/三级子模块：预算管理 ============ */

/** 预算管理（二级页）：本月预算汇总 + 预算行 */
function BudgetsView({ budgets, categories, transactions, onOpenBudget, onAddBudget }: {
  budgets: Budget[];
  categories: Category[];
  transactions: Transaction[];
  onOpenBudget: (budget: Budget) => void;
  onAddBudget: () => void;
}) {
  const month = monthKey();
  const monthTransactions = transactions.filter((item) => item.occurredAt.startsWith(month));
  const monthExpensesAll = monthTransactions.filter((item) => item.type === "expense");
  const monthDailyExpenses = dailyExpenseTransactions(monthTransactions, categories);
  const monthDailySpent = monthDailyExpenses.reduce((sum, item) => sum + item.amountCents, 0);
  const monthTotalSpent = monthExpensesAll.reduce((sum, item) => sum + item.amountCents, 0);
  const monthSpecialSpent = monthTotalSpent - monthDailySpent;
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const dailyOverallBudget = monthBudgets.find((budget) => !budget.categoryId && budgetScope(budget) === "daily");
  const totalBudget = monthBudgets.find((budget) => !budget.categoryId && budgetScope(budget) === "total");
  const categoryBudgets = monthBudgets.filter((budget) => budget.categoryId);
  const dailyBudgetCents = dailyOverallBudget?.amountCents ?? 0;
  const dailyUsage = dailyBudgetCents > 0 ? Math.round((monthDailySpent / dailyBudgetCents) * 100) : 0;

  function spentFor(budget: Budget) {
    if (budget.categoryId) {
      return monthExpensesAll.filter((item) => item.categoryId === budget.categoryId).reduce((sum, item) => sum + item.amountCents, 0);
    }
    return budgetScope(budget) === "total" ? monthTotalSpent : monthDailySpent;
  }

  function labelFor(budget: Budget) {
    if (budget.categoryId) return categories.find((item) => item.id === budget.categoryId)?.name ?? "分类预算";
    return budgetScope(budget) === "total" ? "总开支" : "日常消费";
  }

  const rows: { budget: Budget; icon: typeof Wallet; tone: string }[] = [];
  if (dailyOverallBudget) rows.push({ budget: dailyOverallBudget, icon: CalendarClock, tone: "#1f5f74" });
  if (totalBudget) rows.push({ budget: totalBudget, icon: Target, tone: "#8a5fb0" });
  categoryBudgets.forEach((budget) => rows.push({ budget, icon: Tag, tone: "#2f7d4f" }));

  return (
    <section className="settings-stack">
      <div className="panel asset-summary">
        <div className="asset-summary-main">
          <span>{monthLabel(month)}日常预算</span>
          <strong>{dailyBudgetCents > 0 ? `${dailyUsage}%` : "未设置"}</strong>
        </div>
        <div className="asset-summary-side">
          <span>已花 ¥{centsToYuan(monthDailySpent)}{dailyBudgetCents > 0 ? ` / ¥${centsToYuan(dailyBudgetCents)}` : ""}</span>
          <em>专项支出 ¥{centsToYuan(monthSpecialSpent)}</em>
        </div>
      </div>
      <div className="settings-section account-group">
        <div className="account-group-head">
          <span>预算列表</span>
          <small>{rows.length} 项</small>
        </div>
        <div className="account-group-rows">
          {rows.length === 0 && <p className="empty">本月还没有预算，点下方「新增预算」设置一个吧。</p>}
          {rows.map(({ budget, icon: Icon, tone }) => {
            const spent = spentFor(budget);
            const ratio = Math.min(100, Math.round((spent / Math.max(1, budget.amountCents)) * 100));
            const over = spent > budget.amountCents;
            return (
              <button type="button" className="account-row budget-row" key={budget.id} onClick={() => onOpenBudget(budget)}>
                <span className="account-row-icon" style={{ background: `${tone}1f`, color: tone }}><Icon size={17} /></span>
                <span className="account-row-text">
                  <strong>{labelFor(budget)}</strong>
                  <small>¥{centsToYuan(spent)} / ¥{centsToYuan(budget.amountCents)}{over ? " · 已超支" : ""}</small>
                  <span className={over ? "bar over" : "bar"}><i style={{ width: `${ratio}%` }} /></span>
                </span>
                <ChevronRight size={15} className="settings-row-chevron" />
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" className="primary add-entry-button" onClick={onAddBudget}><Plus size={16} />新增预算</button>
    </section>
  );
}

/** 预算编辑/新增（三级页） */
function BudgetEditorPage({ budget, budgets, categories, onSave, onDelete, onDone }: {
  budget: Budget | null;
  budgets: Budget[];
  categories: Category[];
  onSave: (item: Budget) => Promise<void>;
  onDelete: (item: Budget) => Promise<void>;
  onDone: () => void;
}) {
  const [month, setMonth] = useState(budget?.month ?? monthKey());
  const [budgetKind, setBudgetKind] = useState<"daily" | "total" | "category">(
    budget ? (budget.categoryId ? "category" : budgetScope(budget) === "total" ? "total" : "daily") : "daily"
  );
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? "");
  const [amount, setAmount] = useState(budget ? centsToYuan(budget.amountCents) : "");
  const expenseCategories = categories.filter((item) => item.kind === "expense");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    blurActiveElement();
    const resolvedCategoryId = budgetKind === "category" ? categoryId || null : null;
    const resolvedScope = budgetKind === "total" ? "total" as const : "daily" as const;
    const duplicate = budgets.find((item) =>
      item.id !== budget?.id &&
      item.month === month &&
      (item.categoryId ?? null) === resolvedCategoryId &&
      (!resolvedCategoryId ? budgetScope(item) === resolvedScope : true)
    );
    const existing = budget ?? duplicate;
    const base = existing ?? entityStamp();
    await onSave({
      ...base,
      month,
      categoryId: resolvedCategoryId,
      scope: resolvedScope,
      amountCents: yuanToCents(amount),
      version: existing ? existing.version + 1 : base.version,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    onDone();
  }

  async function remove() {
    if (!budget) return;
    if (!window.confirm(`删除${budget.month} 的这条预算？`)) return;
    blurActiveElement();
    await onDelete(budget);
    onDone();
  }

  return (
    <section className="settings-stack">
      <form className="panel form-stack editor-page" onSubmit={submit}>
        <label>预算月份
          <MonthField value={month} onChange={setMonth} label="预算月份" />
        </label>
        <label>预算类型
          <select value={budgetKind} onChange={(event) => setBudgetKind(event.target.value as "daily" | "total" | "category")}>
            <option value="daily">日常消费总预算</option>
            <option value="total">总开支预算（含日常消费）</option>
            <option value="category">分类预算（归入日常消费）</option>
          </select>
        </label>
        {budgetKind === "category" && (
          <label>预算分类
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
              <option value="" disabled>选择分类</option>
              {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
        )}
        <label>预算金额
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" inputMode="decimal" required autoFocus={!budget} />
        </label>
        <button className="primary" type="submit">保存预算</button>
        {budget && (
          <button type="button" className="ghost danger" onClick={() => void remove()}><Trash2 size={15} />删除预算</button>
        )}
      </form>
    </section>
  );
}

/* ============ 二级/三级子模块：提醒设置与关于 ============ */

/** 提醒设置（二级页）：工资日提醒 / 当日限额提醒 两个入口 */
function RemindersView({ onOpen }: { onOpen: (which: "salary" | "dailyLimit") => void }) {
  return (
    <section className="settings-stack">
      <div className="settings-list">
        <SubEntryRow icon={Banknote} tone="gold" title="工资日提醒" subtitle="纯本地提醒，离线、无服务器也能用" onClick={() => onOpen("salary")} />
        <SubEntryRow icon={BellRing} tone="danger" title="当日限额提醒" subtitle="达线全屏警告与手机推送" onClick={() => onOpen("dailyLimit")} />
      </div>
    </section>
  );
}

/** 提醒详情（三级页） */
function ReminderDetailPage({ which, token, salarySettings, onSalarySettingsChange, dailyLimitSettings, onDailyLimitSettingsChange, onToast }: {
  which: "salary" | "dailyLimit";
  token: string;
  salarySettings: SalarySettings;
  onSalarySettingsChange: (settings: SalarySettings) => void;
  dailyLimitSettings: DailyLimitAlertSettings;
  onDailyLimitSettingsChange: (settings: DailyLimitAlertSettings) => void;
  onToast: (message: string) => void;
}) {
  return (
    <section className="settings-stack">
      {which === "salary" ? (
        <div className="settings-section data-section">
          <div className="data-section-head">
            <span className="settings-row-icon tone-gold"><Banknote size={16} /></span>
            <span className="settings-row-text">
              <strong>工资日提醒</strong>
              <small>纯本地提醒，随时可改</small>
            </span>
          </div>
          <div className="settings-section-body">
            <LocalSalaryReminderPanel value={salarySettings} onChange={onSalarySettingsChange} />
          </div>
        </div>
      ) : (
        <>
          <div className="settings-section data-section">
            <div className="data-section-head">
              <span className="settings-row-icon tone-danger"><BellRing size={16} /></span>
              <span className="settings-row-text">
                <strong>当日限额提醒</strong>
                <small>今日消费达到日限额时全屏红色警告并推送手机提醒</small>
              </span>
            </div>
            <div className="settings-section-body">
              <LocalDailyLimitAlertPanel value={dailyLimitSettings} onChange={onDailyLimitSettingsChange} />
            </div>
          </div>
          <div className="settings-section data-section">
            <div className="data-section-head">
              <span className="settings-row-icon tone-teal"><Bell size={16} /></span>
              <span className="settings-row-text">
                <strong>手机推送</strong>
                <small>应用关闭也能收到的服务端推送</small>
              </span>
            </div>
            <div className="settings-section-body">
              <PushAlertPanel token={token} onToast={onToast} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) outputArray[index] = rawData.charCodeAt(index);
  return outputArray;
}

/** 手机推送订阅管理：开启后服务端可推送限额警告与计划购买提醒（应用关闭也能收到） */
function PushAlertPanel({ token, onToast }: { token: string; onToast: (message: string) => void }) {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setSubscribed(Boolean(subscription));
        setPushSubscribed(Boolean(subscription));
      })
      .catch(() => {
        setSubscribed(false);
        setPushSubscribed(false);
      });
  }, [supported]);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        onToast("通知权限被拒绝，无法开启手机推送");
        return;
      }
      const { publicKey } = await api.notificationVapidKey();
      if (!publicKey) {
        onToast("服务器未配置推送密钥（VAPID），暂无法开启");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await api.subscribeNotifications(token, subscription.toJSON());
      setSubscribed(true);
      setPushSubscribed(true);
      onToast("手机推送已开启：限额警告与可购买提醒会推送到这台设备");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "开启推送失败");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribeNotifications(token, subscription.endpoint).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setPushSubscribed(false);
      onToast("手机推送已关闭");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const result = await api.testNotifications(token);
      onToast(result.delivered ? "测试推送已发送，留意通知栏" : "推送未送达（订阅可能已失效，请重新开启）");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "测试推送失败");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="push-alert-panel">
        <p className="reminder-hint warn">当前浏览器不支持 Web Push。iPhone 需要 iOS 16.4+，且必须从主屏幕图标打开的 PWA 里开启。</p>
      </div>
    );
  }

  return (
    <div className="push-alert-panel">
      <div className={`reminder-status ${subscribed ? "on" : ""}`}>
        <Bell size={16} />
        <span>{subscribed === null ? "检测推送状态…" : subscribed ? "手机推送已开启（这台设备）" : "手机推送未开启"}</span>
        <InfoTip text="开启后即使应用已关闭，服务器也会推送：① 今日消费达限额警告 ② 计划购买「今日余额可买」提醒（各每天最多一条）。iPhone 请先把 App 加到主屏幕，再从主屏幕图标打开后开启。" />
      </div>
      <div className="data-actions">
        {subscribed ? (
          <>
            <button type="button" disabled={busy} onClick={() => void sendTest()}>{busy ? "发送中…" : "发一条测试推送（验证通道）"}</button>
            <button type="button" disabled={busy} onClick={() => void disable()}>关闭推送</button>
          </>
        ) : (
          <button type="button" className="primary" disabled={busy || subscribed === null} onClick={() => void enable()}>
            <Bell size={16} />{busy ? "开启中…" : "开启手机推送"}
          </button>
        )}
      </div>
    </div>
  );
}

/** 设置页导航行（随手记风格）：彩色图标砖 + 标题/副标题 + chevron，点击进入二级子模块 */
function SettingsRow({ icon: Icon, tone, title, subtitle, onClick }: {
  icon: typeof Wallet;
  tone: "danger" | "teal" | "green" | "gold" | "purple";
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-section settings-row" onClick={onClick}>
      <span className="settings-row-head">
        <span className={`settings-row-icon tone-${tone}`}><Icon size={17} /></span>
        <span className="settings-row-text">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <ChevronRight size={16} className="settings-row-chevron" />
      </span>
    </button>
  );
}

/** 版本与更新：显示构建版本（git 短 hash + 构建时间），支持手动检查更新。
 *  排查「手机是不是旧版」的权威依据——iOS PWA 的 ServiceWorker 自动更新
 *  要重开才生效，用户反馈「功能没实现」时先对这里的版本号。 */
function AppVersionPanel({ onToast }: { onToast: (message: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState("");

  const buildTime = (() => {
    try {
      const date = new Date(__BUILD_TIME__);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    } catch {
      return "";
    }
  })();

  async function checkUpdate() {
    if (!("serviceWorker" in navigator)) {
      onToast("当前环境不支持自动更新");
      return;
    }
    setChecking(true);
    setMsg("");
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      setMsg("检查完成；若有新版本会自动下载并刷新（无新版本则保持现状）");
    } catch {
      setMsg("检查失败，请稍后重试");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="form-stack app-version-panel">
      <div className="app-version-row">
        <span>当前版本</span>
        <code>{__APP_VERSION__}</code>
      </div>
      <div className="app-version-row">
        <span>构建时间</span>
        <code>{buildTime}</code>
      </div>
      <button className="ghost" type="button" onClick={() => void checkUpdate()} disabled={checking}>
        <RefreshCw size={15} className={checking ? "spin" : ""} />
        {checking ? "检查中…" : "检查更新"}
      </button>
      {msg && <small className="sync-hint">{msg}</small>}
      <small className="sync-hint">更新为自动下载：点「检查更新」后若拉到新版本会自动刷新；没反应的话把应用划掉重开一次。</small>
    </div>
  );
}

function SyncSettingsPanel() {
  const defaultBase = getDefaultApiBase();
  const [customUrl, setCustomUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState(getApiBase());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    const stored = getApiBase();
    setCustomUrl(stored === defaultBase ? "" : stored);
    setActiveUrl(stored);
  }, [defaultBase]);

  const isCustom = activeUrl !== defaultBase;

  async function handleTest() {
    const url = customUrl.trim();
    if (!url) {
      setTestResult({ ok: false, message: "请输入地址" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await api.testConnection(url.replace(/\/api$/, "") + "/api");
    setTestResult(result);
    setTesting(false);
  }

  function handleSave() {
    const url = customUrl.trim();
    setApiBase(url || null);
    const newBase = getApiBase();
    setActiveUrl(newBase);
    setTestResult(null);
    setSavedMsg(url ? "同步地址已切换，刷新后生效" : "已恢复默认云端地址，刷新后生效");
    setTimeout(() => window.location.reload(), 1000);
  }

  function handleReset() {
    setApiBase(null);
    setActiveUrl(defaultBase);
    setCustomUrl("");
    setTestResult(null);
    setSavedMsg("已恢复默认云端地址，刷新后生效");
    setTimeout(() => window.location.reload(), 1000);
  }

  return (
    <div className="form-stack sync-panel">
      <div className="sync-status-bar">
        {isCustom ? <Cloud size={18} /> : <CloudOff size={18} />}
        <div>
          <strong>{isCustom ? "本地同步" : "云端同步"}</strong>
          <code>{activeUrl}</code>
        </div>
      </div>
      <p className="sync-hint">
        {isCustom
          ? "当前使用本地电脑作为数据同步服务器。电脑需保持运行，手机和电脑需在同一网络（或通过 Tailscale 互联）。"
          : "当前使用云端服务器同步。服务器到期后可切换为本地地址，数据将暂存手机并自动同步到电脑。"}
      </p>
      <label>本地同步地址
        <input
          value={customUrl}
          onChange={(event) => setCustomUrl(event.target.value)}
          placeholder="https://100.x.x.x/api"
          inputMode="url"
        />
      </label>
      <div className="sync-actions">
        <button type="button" className="ghost" onClick={handleTest} disabled={testing}>
          {testing ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
          测试连接
        </button>
        <button type="button" className="primary" onClick={handleSave}>保存并应用</button>
        {isCustom && <button type="button" className="ghost" onClick={handleReset}>恢复云端</button>}
      </div>
      {testResult && (
        <em className={`sync-test-result ${testResult.ok ? "ok" : "fail"}`}>
          {testResult.ok ? "✓ " : "✗ "}{testResult.message}
        </em>
      )}
      {savedMsg && (
        <em className="sync-test-result ok">{savedMsg}</em>
      )}
    </div>
  );
}

function InteractiveDonut({ data, total, selectedIndex, onSelect, onCycleSelect, kind }: {
  data: { id: string; name: string; value: number; color: string; icon?: string }[];
  total: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** 上一项/下一项：只切换选中不改导航（报表页点击扇区才会进分类流水子页） */
  onCycleSelect?: (index: number) => void;
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
    const next = (selectedIndex + offset + data.length) % data.length;
    if (onCycleSelect) onCycleSelect(next);
    else onSelect(next);
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
          <span className="donut-center-label">
            {selected?.icon && <CategoryIcon icon={selected.icon} size={14} />}
            {selected?.name ?? "点击饼图看明细"}
          </span>
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

/** 报表板块子页（本地导航栈，顶栏无返回按钮时用页内返回头） */
type ReportSubPage =
  | { kind: "insightDetail"; id: string }
  | { kind: "anomalyDetail"; id: string }
  | { kind: "categoryDetail"; id: string };

/** 报表模块签（顶部横向滑动选择，参考随手记） */
type ReportTabId = "basic" | "category" | "trend" | "pace" | "regular" | "big" | "special" | "insights" | "anomalies";

const REPORT_TABS: { id: ReportTabId; label: string; monthOnly?: boolean }[] = [
  { id: "basic", label: "基础统计" },
  { id: "category", label: "分类" },
  { id: "trend", label: "趋势" },
  { id: "pace", label: "消费节奏", monthOnly: true },
  { id: "regular", label: "常规项", monthOnly: true },
  { id: "big", label: "大额开销", monthOnly: true },
  { id: "special", label: "专项支出" },
  { id: "insights", label: "核心洞察" },
  { id: "anomalies", label: "异常分析", monthOnly: true }
];

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
  const [reportSubStack, setReportSubStack] = useState<ReportSubPage[]>([]);
  const reportSub = reportSubStack.length > 0 ? reportSubStack[reportSubStack.length - 1] : null;
  const pushReportSub = (page: ReportSubPage) => setReportSubStack((stack) => [...stack, page]);
  const popReportSub = () => setReportSubStack((stack) => stack.slice(0, -1));
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  // 报表详情：从左边缘右滑返回（iOS 风格）
  const reportSwipe = useEdgeSwipeBack({ enabled: reportSub !== null && detailTransaction === null, onBack: popReportSub });
  const [reportTab, setReportTab] = useState<ReportTabId>("basic");
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
    const totals = new Map<string, { id: string; name: string; value: number; color: string; icon?: string }>();
    dailyReportTransactions.forEach((item) => {
      const category = categories.find((entry) => entry.id === item.categoryId);
      const id = category?.id ?? "uncategorized";
      const current = totals.get(id) ?? {
        id,
        name: category ? categoryPath(category, categories) : "未分类",
        value: 0,
        color: category?.color ?? "#8a7154",
        icon: category?.icon ?? "circle"
      };
      current.value += item.amountCents;
      totals.set(id, current);
    });
    return Array.from(totals.values())
      .sort((left, right) => right.value - left.value)
      .map((entry, index) => ({ ...entry, color: reportColor(index) }));
  }, [dailyReportTransactions, categories]);

  const specialCategoryData = useMemo(() => {
    const totals = new Map<string, { id: string; name: string; value: number; color: string; icon?: string }>();
    specialReportTransactions.forEach((item) => {
      const category = categories.find((entry) => entry.id === item.categoryId);
      const id = category?.id ?? "uncategorized";
      const current = totals.get(id) ?? {
        id,
        name: category ? categoryPath(category, categories) : "未分类",
        value: 0,
        color: "#8a7154",
        icon: category?.icon ?? "circle"
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
    setDetailTransaction(null);
    setReportSubStack([]);
    setReportTab("basic");
  }, [month, period, selectedYear]);

  const reportToolbar = (
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
  );

  const activeInsight = reportSub?.kind === "insightDetail"
    ? insightCards.find((card) => card.id === reportSub.id)
    : undefined;
  const activeFinding = reportSub?.kind === "anomalyDetail"
    ? monthlyAnalysis.findings.find((finding) => finding.id === reportSub.id)
    : undefined;
  const activeCategory = reportSub?.kind === "categoryDetail"
    ? categoryData.find((entry) => entry.id === reportSub.id)
    : undefined;
  const activeCategoryTransactions = activeCategory
    ? dailyReportTransactions
      .filter((item) => activeCategory.id === "uncategorized" ? !item.categoryId : item.categoryId === activeCategory.id)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    : [];
  const reportSubHead = (() => {
    switch (reportSub?.kind) {
      case "insightDetail":
        return { title: activeInsight?.title ?? "洞察详情", subtitle: `${activeInsight?.value ?? ""} · ${periodLabel}`.replace(/^ · /, "") };
      case "anomalyDetail":
        return { title: activeFinding?.title ?? "异常详情", subtitle: activeFinding?.value ?? periodLabel };
      case "categoryDetail":
        return { title: activeCategory?.name ?? "分类流水", subtitle: `${periodLabel} · ${activeCategoryTransactions.length} 笔明细` };
      default:
        return { title: "", subtitle: "" };
    }
  })();

  const visibleReportTabs = REPORT_TABS.filter((tab) => period === "month" || !tab.monthOnly);
  const activeReportTab = visibleReportTabs.some((tab) => tab.id === reportTab) ? reportTab : "basic";

  return (
    <section className="report-page" ref={reportSwipe.ref as React.RefObject<HTMLElement>}>
      <EdgeBackHint x={reportSwipe.hintX} />
      {reportToolbar}
      {reportSub ? (
        <>
          <div className="report-subpage-head">
            <button type="button" className="back-button" onClick={popReportSub}>
              <ChevronLeft size={15} /> 返回
            </button>
            <div className="report-subpage-title">
              <h2>{reportSubHead.title}</h2>
              <span>{reportSubHead.subtitle}</span>
            </div>
          </div>

          {reportSub.kind === "insightDetail" && activeInsight && (
            <article className={`insight-card ${activeInsight.tone} expanded`.trim()}>
              <span>{activeInsight.title}</span>
              <strong>{activeInsight.value}</strong>
              <p>{activeInsight.summary}</p>
              <div className="insight-detail">
                <b>完整分析</b>
                <p>{activeInsight.detail}</p>
                <ul>
                  {activeInsight.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </article>
          )}

          {reportSub.kind === "anomalyDetail" && activeFinding && (
            <div className="panel anomaly-detail-page">
              <div className={`anomaly-detail-head ${activeFinding.tone}`}>
                <span>{activeFinding.title}</span>
                <strong>{activeFinding.value}</strong>
                <p>{activeFinding.summary}</p>
              </div>
              <div className="insight-detail">
                <b>完整分析</b>
                <p>{activeFinding.detail}</p>
                <ul>
                  {activeFinding.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <AnalysisNoteEditor
                compact
                value={analysisNoteFor(analysisNotes, month, "anomaly", activeFinding.id)?.content ?? ""}
                placeholder="给这条提醒做备注，例如是否一次性、是否可控、下月怎么处理。"
                onSave={(content) => saveAnalysisNote("anomaly", activeFinding.id, content)}
              />
              {activeFinding.transactions.length > 0 && (
                <TransactionRows
                  transactions={activeFinding.transactions.slice(0, 6)}
                  accounts={accounts}
                  categories={categories}
                  onOpen={setDetailTransaction}
                  compact
                />
              )}
            </div>
          )}

          {reportSub.kind === "categoryDetail" && activeCategory && (
            <>
              <div className="panel report-category-summary">
                <div className="report-category-summary-main">
                  <span>{periodLabel} · 日常消费</span>
                  <strong className="report-category-summary-title">
                    <CategoryIcon icon={activeCategory.icon} size={16} />
                    {activeCategory.name}
                  </strong>
                  <em>
                    {activeCategoryTransactions.length} 笔 · ¥{centsToYuan(activeCategory.value)}
                    {periodSummary.expenseCents > 0 ? ` · 占 ${Math.round((activeCategory.value / periodSummary.expenseCents) * 100)}%` : ""}
                  </em>
                </div>
              </div>
              <div className="panel">
                <TransactionRows
                  transactions={activeCategoryTransactions}
                  accounts={accounts}
                  categories={categories}
                  onOpen={setDetailTransaction}
                  compact
                />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <nav className="page-tabs" aria-label="报表模块">
            {visibleReportTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`page-tab ${activeReportTab === tab.id ? "active" : ""}`.trim()}
                aria-current={activeReportTab === tab.id ? "page" : undefined}
                onClick={() => setReportTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeReportTab === "basic" && (
            <>
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
            </>
          )}

          {activeReportTab === "category" && (
            <div className="panel chart-panel category-analysis">
              <div className="chart-heading">
                <h2>分类统计</h2>
                <span>{periodLabel} · 日常消费明细</span>
              </div>
              <div className="donut-wrap">
                <InteractiveDonut
                  data={categoryData}
                  total={categoryTotal}
                  selectedIndex={selectedCategoryIndex ?? -1}
                  onSelect={(index) => {
                    const entry = categoryData[index];
                    if (!entry) return;
                    setSelectedCategoryIndex(index);
                    pushReportSub({ kind: "categoryDetail", id: entry.id });
                  }}
                  onCycleSelect={(index) => setSelectedCategoryIndex(index)}
                  kind={categoryKind}
                />
              </div>
              {categoryData.length === 0 && <p className="empty">本期暂无{categoryKind === "expense" ? "支出" : "收入"}分类数据</p>}
              {categoryData.length > 0 && (
                <div className="report-category-list">
                  {categoryData.map((entry, index) => (
                    <button
                      type="button"
                      className={`report-category-row ${selectedCategoryIndex === index ? "active" : ""}`.trim()}
                      key={entry.id}
                      onClick={() => {
                        setSelectedCategoryIndex(index);
                        pushReportSub({ kind: "categoryDetail", id: entry.id });
                      }}
                    >
                      <span className="report-category-icon" style={{ background: `${entry.color}1f`, color: entry.color }}><CategoryIcon icon={entry.icon} size={15} /></span>
                      <span className="report-category-name">{entry.name}</span>
                      <strong>¥{centsToYuan(entry.value)}</strong>
                      <em>{periodSummary.expenseCents > 0 ? Math.round((entry.value / periodSummary.expenseCents) * 100) : 0}%</em>
                      <ChevronRight size={15} className="settings-row-chevron" />
                    </button>
                  ))}
                  <p className="report-category-hint">点击分类查看本期流水明细</p>
                </div>
              )}
            </div>
          )}

          {activeReportTab === "trend" && (
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
                defaultOpen
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
                defaultOpen
              />
            </div>
          )}

          {activeReportTab === "pace" && (
            <section className="panel">
              <div className="chart-heading">
                <h2>本月消费节奏</h2>
                <span>{monthLabel(month)} · 每日累计 vs 预算参考线</span>
              </div>
              <TrendFocusCards month={month} transactions={transactions} categories={categories} budgetCents={monthlyAnalysis.budgetCents} />
              <DailyPaceChart month={month} transactions={transactions} categories={categories} budgetCents={monthlyAnalysis.budgetCents} />
            </section>
          )}

          {activeReportTab === "regular" && (
            <section className="panel">
              <div className="chart-heading">
                <h2>常规项支出</h2>
                <span>近6个月 · 每月固定开销逐月对比</span>
              </div>
              <RegularExpensePanel month={month} transactions={transactions} categories={categories} />
            </section>
          )}

          {activeReportTab === "big" && (
            <section className="panel">
              <div className="chart-heading">
                <h2>大额开销</h2>
                <span>{monthLabel(month)} · 清单 + 规律识别（纯统计规则，无 AI）</span>
              </div>
              <BigExpensePanel month={month} transactions={transactions} categories={categories} accounts={accounts} />
            </section>
          )}

          {activeReportTab === "special" && (
            <section className="panel">
              <div className="chart-heading">
                <h2>专项支出</h2>
                <span>{periodLabel} · {specialCategoryData.length} 类 · 单独统计，不纳入日常趋势</span>
              </div>
              {specialCategoryData.length > 0 ? (
                <div className="special-expense-grid">
                  {specialCategoryData.map((entry) => (
                    <div className="budget-line special-expense-line" key={entry.id}>
                      <span className="special-expense-name">
                        <CategoryIcon icon={entry.icon} size={14} />
                        {entry.name}
                      </span>
                      <strong>¥{centsToYuan(entry.value)}</strong>
                      <div className="bar"><i style={{ width: `${Math.max(3, Math.round((entry.value / Math.max(1, specialSummary.expenseCents)) * 100))}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">本期暂无专项支出（贷款、保险、教育等会单独统计）</p>
              )}
            </section>
          )}

          {activeReportTab === "insights" && (
            <div className="finance-insights">
              {insightCards.map((card) => (
                <button
                  type="button"
                  className={`insight-card ${card.tone}`.trim()}
                  key={card.id}
                  onClick={() => pushReportSub({ kind: "insightDetail", id: card.id })}
                >
                  <span>{card.title}</span>
                  <strong>{card.value}</strong>
                  <p>{card.summary}</p>
                  <em>查看详情</em>
                </button>
              ))}
            </div>
          )}

          {activeReportTab === "anomalies" && (
            <>
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
                  {monthlyAnalysis.findings.map((finding) => (
                    <button
                      type="button"
                      className={`anomaly-row ${finding.tone}`}
                      key={finding.id}
                      onClick={() => pushReportSub({ kind: "anomalyDetail", id: finding.id })}
                    >
                      <div>
                        <span>{finding.title}</span>
                        <strong>{finding.value}</strong>
                        <p>{finding.summary}</p>
                      </div>
                      <em>详情</em>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty">本月没有触发显著异常，建议仍保留一条人工复盘笔记，记录是否有即将发生的大额支出。</p>
              )}
            </>
          )}
        </>
      )}
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

function TrendFoldPanel({ title, rangeLabel, legendLabel, data, periodKind, selectedIndex, onSelect, colorOffset = 0, totalMode = false, defaultOpen = false }: {
  title: string;
  rangeLabel: string;
  legendLabel: string;
  data: TrendPoint[];
  periodKind: ReportPeriod;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  colorOffset?: number;
  totalMode?: boolean;
  defaultOpen?: boolean;
}) {
  const maxTrend = Math.max(1, ...data.map((entry) => entry.expense));
  const activeTrendIndex = selectedIndex ?? data.length - 1;
  const selectedTrend = data[activeTrendIndex] ?? data[data.length - 1];
  const selectedTrendLabel = selectedTrend
    ? periodKind === "month" ? monthLabel(selectedTrend.period) : yearLabel(selectedTrend.period)
    : "暂无数据";
  const trendScopeLabel = totalMode ? "历史支出趋势" : periodKind === "month" ? "历史消费趋势" : "多年消费趋势";

  return (
    <details className={`panel chart-panel trend-panel trend-fold-panel ${totalMode ? "total-trend-panel" : "daily-trend-panel"}`} open={defaultOpen}>
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
          <em>点击{periodKind === "month" ? "月份" : "年份"}柱子，金额就在柱子旁显示</em>
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
                <span className="trend-track-wrap">
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
                  {isActive && (
                    <span className="trend-bubble" key={item.period} style={
                      (fillWidth > 72
                        ? { left: `${fillWidth}%`, translate: "calc(-100% - 0.32rem) -50%" }
                        : { left: `calc(${Math.max(fillWidth, 3)}% + 0.45rem)` }) as CSSProperties
                    }>
                      ¥{centsToYuan(item.expense)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

/** 流水回收站：删除的流水先软删除进这里，可恢复；「彻底删除」才真正抹掉（本地删行 + 服务端硬删除） */
function Trash({ transactions, accounts, categories, onRestore, onPurge, onClear }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onRestore: (item: Transaction) => Promise<void>;
  onPurge: (item: Transaction) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const rows = useMemo(
    () => [...transactions].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
    [transactions]
  );

  return (
    <section className="panel trash-panel">
      <div className="trash-head">
        <div className="trash-head-text">
          <h2>流水回收站</h2>
          <p>{rows.length > 0 ? `共 ${rows.length} 笔已删除流水，可恢复或彻底删除` : "删除的流水会先放到这里，可随时恢复"}</p>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            className="ghost danger"
            onClick={() => {
              if (window.confirm(`彻底删除全部 ${rows.length} 笔流水？删除后不可恢复。`)) void onClear();
            }}
          >
            <Trash2 size={15} />清空回收站
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="empty">回收站是空的</p>
      ) : (
        <div className="rows trash-rows">
          {rows.map((item) => {
            const account = accounts.find((entry) => entry.id === item.accountId);
            const category = categories.find((entry) => entry.id === item.categoryId);
            const sign = item.type === "expense" ? "-" : item.type === "income" ? "+" : "";
            const title = item.merchant || category?.name || typeLabels[item.type];
            const deletedLabel = item.deletedAt
              ? new Date(item.deletedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
              : "";
            const meta = `删除于 ${deletedLabel} · ${new Date(item.occurredAt).toLocaleDateString("zh-CN")} · ${account?.name ?? ""}`;
            return (
              <article className={`row row-type-${item.type}`} key={item.id}>
                <div className={`row-icon ${item.type}`}>{item.type === "transfer" ? <ArrowRightLeft size={15} /> : item.type === "income" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</div>
                <div className="row-main">
                  <strong>{title}</strong>
                  <span>{meta}</span>
                </div>
                <div className="row-side">
                  <b>{sign}¥{centsToYuan(item.amountCents)}</b>
                  <div className="row-actions">
                    <button className="icon-button mini" onClick={() => void onRestore(item)} title="恢复"><RotateCcw size={14} /></button>
                    <button
                      className="icon-button mini danger"
                      onClick={() => {
                        if (window.confirm(`彻底删除「${title}」？删除后不可恢复。`)) void onPurge(item);
                      }}
                      title="彻底删除"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
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
