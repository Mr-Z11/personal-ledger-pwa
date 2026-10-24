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

/** 回收站「彻底删除」：给同步载荷打 purge 标记（服务端硬删除该行；软删除的 deletedAt 不足以让它从快照里消失） */
export function markPurged(item: Transaction): Transaction {
  return { ...item, purge: true };
}

export function markAllPurged(items: Transaction[]): Transaction[] {
  return items.map(markPurged);
}

/* ==================== 分类图标自动补全 ==================== */

/** 新建分类时 API 给的默认值 */
export const DEFAULT_CATEGORY_ICON = "circle";
/** 视为「还没配过图标」的占位值：默认值 circle + 批量导入时落到「其他」的 folder */
export const PLACEHOLDER_CATEGORY_ICONS = ["circle", "folder"];

/** 判断一个 icon 值是否算「未配图标」：空值、占位值都算 */
export function isPlaceholderCategoryIcon(icon?: string | null): boolean {
  return !icon || PLACEHOLDER_CATEGORY_ICONS.includes(icon);
}

/** 分类名关键词 → 图标 id。按数组顺序匹配、命中即返回，
 *  所以**具体的词必须排在泛化的词前面**（「加油」要在「车」前、「咖啡」要在「餐饮」前）。 */
const categoryIconRules: { icon: string; keywords: string[] }[] = [
  // —— 餐饮 / 食品酒水 ——
  { icon: "coffee", keywords: ["咖啡", "奶茶", "茶饮", "饮品", "饮料", "果汁", "星巴克"] },
  { icon: "utensils", keywords: ["餐饮", "外食", "外出美食", "美食", "吃饭", "三餐", "伙食", "外卖", "餐厅", "食堂", "早餐", "午餐", "晚餐", "夜宵", "午饭", "晚饭"] },
  { icon: "soup", keywords: ["汤", "粥"] },
  { icon: "pizza", keywords: ["快餐", "汉堡", "面食", "面条", "米粉", "肯德基", "麦当劳"] },
  { icon: "cake", keywords: ["蛋糕", "甜点", "烘焙", "面包"] },
  { icon: "popcorn", keywords: ["零食", "小吃", "饼干"] },
  { icon: "popsicle", keywords: ["冰品", "雪糕", "冰淇淋", "冷饮"] },
  { icon: "apple", keywords: ["水果"] },
  { icon: "carrot", keywords: ["蔬菜", "买菜", "菜场"] },
  { icon: "wheat", keywords: ["主食", "粮食", "米面"] },
  { icon: "beef", keywords: ["肉类", "猪肉", "牛肉"] },
  { icon: "drumstick", keywords: ["禽肉", "鸡肉"] },
  { icon: "fish", keywords: ["海鲜", "水产"] },
  { icon: "milk", keywords: ["牛奶", "奶制品", "蛋奶"] },
  { icon: "wine", keywords: ["酒水", "红酒", "白酒"] },
  { icon: "beer", keywords: ["啤酒"] },
  { icon: "martini", keywords: ["鸡尾酒", "洋酒"] },
  { icon: "cigarette", keywords: ["香烟", "烟"] },

  // —— 居家物业 ——
  { icon: "home", keywords: ["居家", "房租", "房贷", "租房", "物业", "装修", "房屋"] },
  { icon: "droplets", keywords: ["水费", "用水"] },
  { icon: "zap", keywords: ["电费", "用电"] },
  { icon: "flame", keywords: ["燃气", "煤气", "取暖"] },
  { icon: "wifi", keywords: ["网费", "网络", "宽带", "上网", "流量"] },
  { icon: "plug", keywords: ["电器", "电费"] },
  { icon: "wrench", keywords: ["维修", "维护", "换新", "修理"] },
  { icon: "sofa", keywords: ["家具", "家居"] },
  { icon: "washing-machine", keywords: ["家电"] },
  { icon: "refrigerator", keywords: ["冰箱"] },
  { icon: "lightbulb", keywords: ["灯泡", "照明"] },
  { icon: "shopping-bag", keywords: ["超市", "便利店", "日用", "购物"] },
  { icon: "shopping-cart", keywords: ["网购", "电商", "淘宝", "京东"] },
  { icon: "store", keywords: ["商户", "门店"] },

  // —— 行车交通 ——
  { icon: "tram-front", keywords: ["地铁", "轨道交通"] },
  { icon: "bus", keywords: ["公交", "公共交通", "大巴"] },
  { icon: "train-front", keywords: ["火车", "高铁", "动车"] },
  { icon: "car-taxi-front", keywords: ["打车", "出租", "网约车", "出行", "交通"] },
  { icon: "fuel", keywords: ["加油", "燃油", "充电"] },
  { icon: "bike", keywords: ["单车", "自行车", "骑行"] },
  { icon: "plane", keywords: ["飞机", "机票", "航空"] },
  { icon: "ship", keywords: ["轮船", "船票"] },
  { icon: "sailboat", keywords: ["游船", "邮轮"] },
  { icon: "luggage", keywords: ["行李", "出游", "旅程"] },
  { icon: "car", keywords: ["养车", "购车", "停车", "过路", "用车"] },

  // —— 通讯 / 数码 ——
  { icon: "smartphone", keywords: ["手机", "话费", "通讯"] },
  { icon: "phone", keywords: ["电话", "通讯"] },
  { icon: "laptop", keywords: ["电脑", "数码", "笔记本"] },
  { icon: "monitor", keywords: ["显示器"] },
  { icon: "tv", keywords: ["电视"] },
  { icon: "camera", keywords: ["相机", "摄影"] },

  // —— 娱乐 / 旅行 / 社交 ——
  { icon: "gamepad-2", keywords: ["游戏", "娱乐"] },
  { icon: "film", keywords: ["电影", "影视", "演出"] },
  { icon: "music", keywords: ["音乐"] },
  { icon: "headphones", keywords: ["听书", "耳机", "配件"] },
  { icon: "ticket", keywords: ["演出", "门票", "中奖", "彩票"] },
  { icon: "crown", keywords: ["会员", "订阅"] },
  { icon: "sparkles", keywords: ["休闲", "玩乐", "化妆", "美妆", "美容", "护肤", "饰品", "护理"] },
  { icon: "gem", keywords: ["收藏", "珠宝"] },
  { icon: "map", keywords: ["旅游", "旅行"] },
  { icon: "palmtree", keywords: ["度假", "假期"] },
  { icon: "compass", keywords: ["户外", "徒步"] },
  { icon: "mountain", keywords: ["登山", "爬山"] },
  { icon: "globe", keywords: ["签证", "出入境"] },
  { icon: "bed", keywords: ["酒店", "住宿"] },
  { icon: "gift", keywords: ["人情", "礼金", "送礼", "请客", "礼物"] },
  { icon: "hand-coins", keywords: ["红包", "压岁"] },
  { icon: "heart", keywords: ["孝敬", "捐助", "慈善", "家人", "家长"] },

  // —— 母婴 / 宠物 ——
  { icon: "baby", keywords: ["亲子", "孩子", "育儿", "保姆", "母婴", "亲子教育"] },
  { icon: "paw-print", keywords: ["宠物", "宝贝"] },

  // —— 医疗 / 教育 ——
  { icon: "heart-pulse", keywords: ["医疗", "健康", "体检", "保险", "保费"] },
  { icon: "pill", keywords: ["药品", "医药", "吃药"] },
  { icon: "pill-bottle", keywords: ["保健"] },
  { icon: "graduation-cap", keywords: ["学费", "培训", "进修", "教育", "课外", "托管", "学习"] },
  { icon: "book-open", keywords: ["书籍", "图书", "书报", "杂志", "资料", "阅读", "书本"] },
  { icon: "book", keywords: ["文具", "课本"] },
  { icon: "pencil", keywords: ["兴趣班", "兴趣", "课程", "考试", "竞赛"] },

  // —— 金融 ——
  { icon: "coins", keywords: ["利息", "理财", "投资", "基金"] },
  { icon: "piggy-bank", keywords: ["储蓄", "存款"] },
  { icon: "trending-up", keywords: ["股票", "证券"] },
  { icon: "landmark", keywords: ["银行", "贷款", "还款", "税费"] },
  { icon: "banknote", keywords: ["现金", "奖金", "工资", "取现"] },
  { icon: "wallet", keywords: ["钱包", "收入记录"] },
  { icon: "briefcase", keywords: ["办公", "职业", "兼职", "加班", "经营", "副业"] },

  // —— 服饰 / 箱包 ——
  { icon: "shirt", keywords: ["服饰", "服装", "鞋帽", "校服", "穿衣"] },
  { icon: "backpack", keywords: ["箱包", "包包", "背包"] },

  // —— 生活杂项 ——
  { icon: "receipt", keywords: ["票据", "杂费", "赔偿", "罚款"] },
  { icon: "umbrella", keywords: ["雨具"] },
  { icon: "sun", keywords: ["防晒"] },
  { icon: "cloud-rain", keywords: ["天气"] },
  { icon: "flower-2", keywords: ["鲜花"] },
  { icon: "leaf", keywords: ["绿植"] },
  { icon: "sprout", keywords: ["盆栽"] },
  { icon: "tree-pine", keywords: ["养护", "园艺"] },
  { icon: "dumbbell", keywords: ["健身", "运动"] },
  { icon: "scissors", keywords: ["理发", "美发"] }
];

/** 按分类名推断图标 id；匹配不到返回 null（调用方决定是否回退默认圆点） */
export function inferCategoryIcon(name: string): string | null {
  const text = name ?? "";
  for (const rule of categoryIconRules) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule.icon;
  }
  return null;
}
