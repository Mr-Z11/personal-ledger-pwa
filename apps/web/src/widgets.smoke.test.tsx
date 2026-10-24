import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { yuanToCents, monthKey, type Account, type Budget, type Category, type Transaction } from "@ledger/shared";
import {
  BigExpensePanel,
  BudgetReservoir,
  DailyPaceChart,
  DailyLimitOverlay,
  FixedExpenseOverview,
  LocalSalaryReminderPanel,
  RegularExpensePanel,
  SalaryBanner,
  TrendFocusCards,
  DEFAULT_SALARY_SETTINGS,
  buildFixedExpenseSuggestions,
  dailyLimitCents,
  loadSalarySettings,
  aggregateByPeriod,
  searchMatches,
  noSpendPraiseDue,
  praiseMessage,
  salaryBannerState,
  saveFixedExpenses,
  saveSalarySettings
} from "./widgets";
import { PlanView, loadInsuranceSchedule, parseInsuranceText, saveInsuranceSchedule } from "./plan";
import {
  inferCategoryIcon,
  isPlaceholderCategoryIcon,
  entryChunkFromIndexHtml,
  markAllPurged,
  markPurged
} from "./utils";

beforeAll(() => {
  const store = new Map<string, string>();
  // @ts-expect-error 简化版 localStorage，足够组件渲染使用
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear()
  };
});

const stamp = { version: 1, updatedAt: new Date().toISOString(), deletedAt: null };

const categories: Category[] = [
  { ...stamp, id: "cat-food", name: "三餐", kind: "expense", parentId: null, icon: "circle", color: "#d45b3f" },
  { ...stamp, id: "cat-loan", name: "贷款本金", kind: "expense", parentId: null, icon: "circle", color: "#8a5fb0" }
];

const accounts: Account[] = [
  { ...stamp, id: "acc-1", name: "消费卡", type: "credit", openingBalanceCents: 0, color: "#1f5f74" }
];

function tx(id: string, amountYuan: number, occurredAt: string, categoryId = "cat-food", merchant?: string): Transaction {
  return {
    ...stamp,
    id,
    type: "expense",
    accountId: "acc-1",
    categoryId,
    amountCents: yuanToCents(amountYuan),
    occurredAt,
    merchant: merchant ?? null,
    note: null,
    tags: []
  };
}

const thisMonth = monthKey();
const sampleTransactions: Transaction[] = [
  tx("t1", 35.5, `${thisMonth}-02T12:00:00.000+08:00`),
  tx("t2", 88, `${thisMonth}-05T12:00:00.000+08:00`),
  tx("t3", 4500, `${thisMonth}-06T12:00:00.000+08:00`, "cat-loan", "招行房贷"),
  tx("t4", 1200, `${thisMonth}-08T12:00:00.000+08:00`, "cat-food", "京东"),
  tx("t5", 4600, `${thisMonth.slice(0, 4)}-0${Number(thisMonth.slice(5)) - 1}-06T12:00:00.000+08:00`, "cat-loan", "招行房贷")
];

describe("widgets 冒烟渲染", () => {
  it("BudgetReservoir 正常/超支/未设预算三种状态都能渲染", () => {
    expect(renderToString(<BudgetReservoir title="日常消费额度" spentCents={150000} budgetCents={300000} accent="#1f5f74" />)).toContain("50%");
    expect(renderToString(<BudgetReservoir title="总开支额度" spentCents={350000} budgetCents={300000} accent="#31473a" />)).toContain("超支");
    expect(renderToString(<BudgetReservoir title="日常消费额度" spentCents={1000} budgetCents={0} accent="#1f5f74" />)).toContain("未设预算");
  });

  it("SalaryBanner 倒计时与工资日两种形态都能渲染", () => {
    expect(renderToString(<SalaryBanner state={{ kind: "countdown", daysLeft: 2, label: "2026年9月10日" }} onDismiss={() => undefined} />)).toContain("距离发工资还有");
    expect(renderToString(<SalaryBanner state={{ kind: "payday", content: "储蓄50%" }} onDismiss={() => undefined} />)).toContain("储蓄50%");
  });

  it("工资日设置本地存取与横幅状态计算", () => {
    saveSalarySettings({ ...DEFAULT_SALARY_SETTINGS, enabled: true, day: 10, leadDays: 3, content: "test" });
    const loaded = loadSalarySettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.day).toBe(10);
    // day=10 且 leadDays=3 时，无论今天几号，状态必须是确定性的三种之一
    const state = salaryBannerState(loaded, null);
    expect(state === null || state.kind === "payday" || state.kind === "countdown").toBe(true);
  });

  it("DailyPaceChart / TrendFocusCards / BigExpensePanel 有数据时能渲染", () => {
    const pace = renderToString(<DailyPaceChart month={thisMonth} transactions={sampleTransactions} categories={categories} budgetCents={300000} />);
    expect(pace).toContain("pace-chart");
    const focus = renderToString(<TrendFocusCards month={thisMonth} transactions={sampleTransactions} categories={categories} budgetCents={300000} />);
    expect(focus).toContain("环比");
    expect(focus).toContain("同比");
    const big = renderToString(<BigExpensePanel month={thisMonth} transactions={sampleTransactions} categories={categories} accounts={accounts} />);
    expect(big).toContain("大额合计");
  });

  it("DailyPaceChart / BigExpensePanel 空数据时不崩溃", () => {
    expect(renderToString(<DailyPaceChart month={thisMonth} transactions={[]} categories={categories} budgetCents={0} />)).toContain("pace-chart");
    expect(renderToString(<BigExpensePanel month={thisMonth} transactions={[]} categories={categories} accounts={accounts} />)).toContain("没有超过");
  });

  it("LocalSalaryReminderPanel 可渲染", () => {
    const html = renderToString(<LocalSalaryReminderPanel value={DEFAULT_SALARY_SETTINGS} onChange={() => undefined} />);
    expect(html).toContain("工资日");
    expect(html).toContain("提前倒计时");
  });
});

function monthOffsetKey(offset: number) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const regularTransactions: Transaction[] = [];
for (let offset = -5; offset <= 0; offset += 1) {
  const key = monthOffsetKey(offset);
  regularTransactions.push(tx(`r-food-${offset}`, 120 + offset * 5, `${key}-03T12:00:00.000+08:00`));
  regularTransactions.push(tx(`r-loan-${offset}`, 4500, `${key}-06T12:00:00.000+08:00`, "cat-loan", "招行房贷"));
}

describe("常规项支出与规划页", () => {
  it("RegularExpensePanel 识别连续出现的分类并逐月对比", () => {
    const html = renderToString(<RegularExpensePanel month={thisMonth} transactions={regularTransactions} categories={categories} />);
    expect(html).toContain("常规项");
    expect(html).toContain("三餐");
    expect(html).toContain("月均");
    expect(html).toContain("环比");
  });

  it("RegularExpensePanel 空数据时给出提示", () => {
    const html = renderToString(<RegularExpensePanel month={thisMonth} transactions={[]} categories={categories} />);
    expect(html).toContain("暂无常规项");
  });

  it("PlanView 渲染预测 KPI 与模块签（各模块内容点签后展示）", () => {
    const budgets: Budget[] = [
      { ...stamp, id: "b-total", month: monthOffsetKey(1), categoryId: null, amountCents: yuanToCents(9000), scope: "total" }
    ];
    const html = renderToString(<PlanView transactions={regularTransactions} categories={categories} budgets={budgets} />);
    // 总览签（默认）：预测 KPI
    expect(html).toContain("预测总支出");
    expect(html).toContain("预测日常消费");
    expect(html).toContain("去年同期");
    expect(html).toContain("规划月份");
    expect(html).toContain('type="month"');
    // 模块签齐全：趋势/逐月明细/支出项/保险日历/预测依据点签后渲染
    expect(html).toContain("page-tabs");
    for (const label of ["总览", "趋势", "逐月明细", "支出项", "保险日历", "预测依据"]) {
      expect(html).toContain(`>${label}</button>`);
    }
  });

  it("PlanView 空数据时不崩溃", () => {
    const html = renderToString(<PlanView transactions={[]} categories={categories} budgets={[]} />);
    expect(html).toContain("支出规划");
  });

  it("保险缴费日历：粘贴解析 + 本地存取 + 规划页引用", () => {
    const parsed = parseInsuranceText("11月 重疾险续费 4000\n11月 百万医疗 700\n6月 重疾险 4056\n13月 非法月份 100\n坏行");
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ month: 11, name: "重疾险续费", amountCents: 400000 });
    saveInsuranceSchedule(parsed);
    const loaded = loadInsuranceSchedule();
    expect(loaded).toHaveLength(3);
    expect(loaded[1].amountCents).toBe(70000);
    const html = renderToString(<PlanView transactions={regularTransactions} categories={categories} budgets={[]} />);
    // 保险日程保存后：总览签 KPI 引用修正结果；面板本体在「保险日历」签内
    expect(html).toContain("已按保险日历修正");
    expect(html).toContain("保险日历");
    saveInsuranceSchedule([]);
  });

  it("FixedExpenseOverview 手动模式渲染关键标签与空状态", () => {
    const html = renderToString(<FixedExpenseOverview />);
    expect(html).toContain("本月固定支出");
    expect(html).toContain("固定项合计");
    expect(html).toContain("已支出合计");
    expect(html).toContain("待支出额度");
    expect(html).toContain("手动维护");
    expect(html).toContain("还没有固定支出项");
  });

  it("FixedExpenseOverview 从 localStorage 读取手动项目", () => {
    saveFixedExpenses(monthKey(), [
      { id: "fx-test-1", name: "房租", predictedCents: 300000, spentCents: 100000 },
      { id: "fx-test-2", name: "物业费", predictedCents: 50000, spentCents: 0 }
    ]);
    const html = renderToString(<FixedExpenseOverview />);
    expect(html).toContain("房租");
    expect(html).toContain("物业费");
    expect(html).toContain("剩 ¥2000.00");
    saveFixedExpenses(monthKey(), []);
  });

  it("buildFixedExpenseSuggestions 参考项来自常规项与保险日历", () => {
    saveInsuranceSchedule([{ id: "ins1", name: "重疾险", month: Number(thisMonth.slice(5, 7)), amountCents: 470000, note: undefined }]);
    const list = buildFixedExpenseSuggestions(regularTransactions, categories, thisMonth);
    const names = list.map((candidate) => candidate.name);
    expect(names).toContain("其他 > 三餐");
    expect(names).toContain("其他 > 贷款本金");
    expect(names.some((name) => name.includes("保险"))).toBe(true);
    const loan = list.find((candidate) => candidate.name === "其他 > 贷款本金");
    expect(loan?.categoryId).toBe("cat-loan");
    saveInsuranceSchedule([]);
  });

  it("FixedExpenseOverview 关联分类时自动跟踪当月已支出", () => {
    saveFixedExpenses(monthKey(), [
      { id: "fx-auto-1", name: "三餐", predictedCents: 20000, spentCents: 0, categoryId: "cat-food" }
    ]);
    const html = renderToString(<FixedExpenseOverview transactions={sampleTransactions} categories={categories} />);
    expect(html).toContain("自动");
    // sampleTransactions 中 cat-food 当月合计 35.5 + 88 + 1200 = 1323.50 元
    expect(html).toContain("1323.50");
    saveFixedExpenses(monthKey(), []);
  });

  it("FixedExpenseOverview 新增入口默认只有一个图标按钮，不占一整行表单", () => {
    const html = renderToString(<FixedExpenseOverview transactions={[]} categories={categories} />);
    // 默认收起：只有 ＋ 图标按钮，没有常驻的输入行
    expect(html).toContain("新增固定支出项");
    expect(html).not.toContain("关联分类（可选）");
    expect(html).not.toContain("新项目（如：房租）");
  });

  it("FixedExpenseOverview 渲染最低固定支出：固定项合计 + 浮动金额 = 每月最低支出", () => {
    saveFixedExpenses(monthKey(), [
      { id: "fx-r1", name: "房租", predictedCents: 300000, spentCents: 0 },
      { id: "fx-r2", name: "物业费", predictedCents: 50000, spentCents: 0 }
    ]);
    // 浮动金额：3000 + 500 = 3500，再加浮动 2500 → 每月最低支出 6000
    localStorage.setItem("ledger-fixed-float-amount", "2500");
    const html = renderToString(<FixedExpenseOverview />);
    expect(html).toContain("最低固定支出");
    expect(html).toContain("砍掉大额与弹性消费后");
    expect(html).toContain("¥6000.00");
    localStorage.removeItem("ledger-fixed-float-amount");
    saveFixedExpenses(monthKey(), []);
  });

  it("dailyLimitCents 为动态限额：当日消费不影响当日限额，昨日消费才计入", () => {
    const month = monthKey();
    const budgets: Budget[] = [{ ...stamp, id: "b-daily", month, categoryId: null, amountCents: yuanToCents(3000), scope: "daily" }];
    const todayKeyStr = new Date().toISOString().slice(0, 10);
    const [yy, mm, dd] = todayKeyStr.split("-").map(Number);
    const yDate = new Date(yy, mm - 1, dd);
    yDate.setDate(yDate.getDate() - 1);
    const yesterdayKeyStr = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, "0")}-${String(yDate.getDate()).padStart(2, "0")}`;
    const mkTx = (day: string, amountYuan: number) => ({
      ...stamp, id: `t-${day}-${amountYuan}`, type: "expense" as const, accountId: "acc-1",
      categoryId: "cat-food", amountCents: yuanToCents(amountYuan), occurredAt: `${day}T12:00:00.000+08:00`,
      merchant: null, note: null, tags: []
    });
    const limitNoSpend = dailyLimitCents(budgets, [], categories, month);
    const limitWithTodaySpend = dailyLimitCents(budgets, [mkTx(todayKeyStr, 500)], categories, month);
    // 当日消费不改变当日限额
    expect(limitWithTodaySpend).toBe(limitNoSpend);
    if (yesterdayKeyStr.slice(0, 7) === month) {
      const limitWithYesterdaySpend = dailyLimitCents(budgets, [mkTx(yesterdayKeyStr, 500)], categories, month);
      // 昨日消费计入剩余预算，限额变小
      expect(limitWithYesterdaySpend).toBeLessThan(limitNoSpend);
    }
  });
});

describe("搜索记录：关键词匹配与按月/年汇总", () => {
  const searchTxs: Transaction[] = [
    tx("s1", 200, "2026-03-05T10:00:00.000+08:00", "cat-food", "加油 中石化"),
    tx("s2", 300, "2026-03-20T10:00:00.000+08:00", "cat-food", "加油站"),
    tx("s3", 100, "2026-04-11T10:00:00.000+08:00", "cat-loan", "吃饭"),
    tx("s4", 500, "2025-12-02T10:00:00.000+08:00", "cat-food", "加油"),
    { ...tx("s5", 999, "2026-03-08T10:00:00.000+08:00", "cat-food", "加油"), type: "income" as const }
  ];

  it("按关键词匹配消费记录，排除收入", () => {
    const hits = searchMatches("加油", searchTxs, accounts, categories);
    expect(hits.map((item) => item.id).sort()).toEqual(["s1", "s2", "s4"]);
  });

  it("按月份汇总支出（含笔数与金额）", () => {
    const hits = searchMatches("加油", searchTxs, accounts, categories);
    const byMonth = aggregateByPeriod(hits, 7);
    expect(byMonth).toEqual([
      { key: "2026-03", count: 2, cents: yuanToCents(500) },
      { key: "2025-12", count: 1, cents: yuanToCents(500) }
    ]);
  });

  it("按年份汇总支出", () => {
    const hits = searchMatches("加油", searchTxs, accounts, categories);
    const byYear = aggregateByPeriod(hits, 4);
    expect(byYear).toEqual([
      { key: "2026", count: 2, cents: yuanToCents(500) },
      { key: "2025", count: 1, cents: yuanToCents(500) }
    ]);
  });
});

describe("低消费表扬：时段判定与文案", () => {
  it("19 点之前（含上午/中午/下午/傍晚）一律不提醒——用户要求只在晚上 19 点发一条", () => {
    expect(noSpendPraiseDue(9, 0, 5000)).toBeNull();
    expect(noSpendPraiseDue(13, 0, 5000)).toBeNull();
    expect(noSpendPraiseDue(14, 3000, 5000)).toBeNull();
    expect(noSpendPraiseDue(17, 0, 5000)).toBeNull();
    expect(noSpendPraiseDue(17, 3000, 5000)).toBeNull();
    expect(noSpendPraiseDue(18, 0, 5000)).toBeNull();
  });

  it("晚上（≥19点）没花钱 → 表扬 zero", () => {
    expect(noSpendPraiseDue(19, 0, 5000)).toEqual({ period: "pm", kind: "zero" });
    expect(noSpendPraiseDue(20, 0, 5000)).toEqual({ period: "pm", kind: "zero" });
  });

  it("晚上低于日限额（未过度消费）→ 表扬 thrifty", () => {
    expect(noSpendPraiseDue(19, 3000, 5000)).toEqual({ period: "pm", kind: "thrifty" });
  });

  it("晚上花了一笔专项支出（日常=0、全部>0）→ 不误判 zero，按日常口径判 thrifty", () => {
    // 第 4 个参数 totalSpentTodayCents 为今日全部支出（含专项）
    expect(noSpendPraiseDue(19, 0, 5000, 3000)).toEqual({ period: "pm", kind: "thrifty" });
  });

  it("晚上花专项但无预算（limit=0）→ 不表扬（避免大额专项支出还被夸）", () => {
    expect(noSpendPraiseDue(19, 0, 0, 3000)).toBeNull();
  });

  it("今日全部支出真的为 0 → 表扬 zero", () => {
    expect(noSpendPraiseDue(19, 0, 5000, 0)).toEqual({ period: "pm", kind: "zero" });
  });

  it("达到/超过日限额 → 不表扬", () => {
    expect(noSpendPraiseDue(19, 5000, 5000)).toBeNull();
    expect(noSpendPraiseDue(19, 6000, 5000)).toBeNull();
  });

  it("文案包含正向鼓励关键词", () => {
    expect(praiseMessage("zero")).toContain("存款");
    expect(praiseMessage("thrifty")).toContain("压力");
  });
});

describe("当日限额全屏警告文案", () => {
  it("明确标注大额数字是「今日已花」，限额单独一行，不产生歧义", () => {
    const html = renderToString(
      <DailyLimitOverlay spentCents={123400} limitCents={120000} toleranceCents={2000} onDismiss={() => {}} />
    );
    expect(html).toContain("今日已花（实际消费）");
    // SSR 会在 ¥ 与数字之间插入注释节点，这里只断言数字
    expect(html).toContain("1234.00");
    expect(html).toContain("今日限额");
    expect(html).toContain("1200.00");
    expect(html).toContain("超出限额");
    expect(html).toContain("34.00");
    expect(html).toContain("今日消费已超出日限额");
  });

  it("误差线内未超出时给出「还没超」而不是金额", () => {
    const html = renderToString(
      <DailyLimitOverlay spentCents={119000} limitCents={120000} toleranceCents={2000} onDismiss={() => {}} />
    );
    expect(html).toContain("今日消费已到日限额");
    expect(html).toContain("误差线内，还没超");
  });
});

describe("回收站彻底删除（purge）", () => {
  const deleted = { ...tx("t-purge", 66, `${thisMonth}-10T12:00:00.000+08:00`), deletedAt: new Date().toISOString() };

  it("单笔打 purge 标记，其余字段原样保留", () => {
    const payload = markPurged(deleted);
    expect(payload.purge).toBe(true);
    expect(payload.id).toBe("t-purge");
    expect(payload.amountCents).toBe(deleted.amountCents);
    expect(payload.deletedAt).toBe(deleted.deletedAt);
  });

  it("批量全部打标记且不改原数组", () => {
    const payload = markAllPurged([deleted, tx("t-purge-2", 12, `${thisMonth}-11T12:00:00.000+08:00`)]);
    expect(payload.every((item) => item.purge === true)).toBe(true);
    expect(deleted.purge).toBeUndefined();
  });
});

describe("现有分类自动补图标（inferCategoryIcon）", () => {
  /** 库里真实存在的分类名 → 期望图标；null = 确实属于「其他/专项」兜底桶，保持占位图标不动 */
  const cases: [string, string | null][] = [
      ["上网费", "wifi"],
      ["专项支出", null],
      ["中奖收入", "ticket"],
      ["书报杂志", "book-open"],
      ["书籍资料", "book-open"],
      ["买菜", "carrot"],
      ["交流通讯", "smartphone"],
      ["交通出行", "car-taxi-front"],
      ["亲子教育", "baby"],
      ["亲子活动", "baby"],
      ["人情往来", "gift"],
      ["人情礼金", "gift"],
      ["休闲娱乐", "gamepad-2"],
      ["休闲玩乐", "sparkles"],
      ["休闲社交", "sparkles"],
      ["保健运动", "pill-bottle"],
      ["保姆费用", "baby"],
      ["保险", "heart-pulse"],
      ["健康医疗", "heart-pulse"],
      ["公共交通", "bus"],
      ["兴趣课程", "pencil"],
      ["其他", null],
      ["其他支出", null],
      ["其他收入", null],
      ["其他杂项", null],
      ["兼职收入", "briefcase"],
      ["出行", "car-taxi-front"],
      ["利息支出", "coins"],
      ["利息收入", "coins"],
      ["副业", "briefcase"],
      ["加油", "fuel"],
      ["加班收入", "briefcase"],
      ["化妆饰品", "sparkles"],
      ["医疗药品", "heart-pulse"],
      ["医药费", "pill"],
      ["压岁钱", "hand-coins"],
      ["图书文具", "book-open"],
      ["培训进修", "graduation-cap"],
      ["外出美食", "utensils"],
      ["外食", "utensils"],
      ["奖金收入", "banknote"],
      ["孝敬家人", "heart"],
      ["孝敬家长", "heart"],
      ["学习成长", "graduation-cap"],
      ["学习进修", "graduation-cap"],
      ["学费托管", "graduation-cap"],
      ["孩子", "baby"],
      ["孩子教育", "baby"],
      ["宠物宝贝", "paw-print"],
      ["居家日用", "home"],
      ["居家物业", "home"],
      ["工资", "banknote"],
      ["工资收入", "banknote"],
      ["意外丢失", null],
      ["意外来钱", null],
      ["慈善捐助", "heart"],
      ["房租", "home"],
      ["手机费", "smartphone"],
      ["打车租车", "car-taxi-front"],
      ["投资收入", "coins"],
      ["收入记录", "wallet"],
      ["教育", "graduation-cap"],
      ["教育培训", "graduation-cap"],
      ["教育杂费", "graduation-cap"],
      ["数码装备", "laptop"],
      ["旅游", "map"],
      ["日用品", "shopping-bag"],
      ["服装鞋包", "shirt"],
      ["服饰个护", "shirt"],
      ["未分类大额", null],
      ["校服用品", "shirt"],
      ["水电物业", "home"],
      ["油费过路", "car"],
      ["理财", "coins"],
      ["礼金收入", "gift"],
      ["经营所得", "briefcase"],
      ["维修", "wrench"],
      ["美妆护理", "sparkles"],
      ["考试竞赛", "pencil"],
      ["职业收入", "briefcase"],
      ["课外培训费用", "graduation-cap"],
      ["购车养车", "car"],
      ["贷款利息", "coins"],
      ["贷款本金", "landmark"],
      ["过路费", "car"],
      ["运动健康医疗", "heart-pulse"],
      ["运动健身", "dumbbell"],
      ["通讯数码", "smartphone"],
      ["通讯费", "smartphone"],
      ["金融保险", "heart-pulse"],
      ["零食饮料", "coffee"],
      ["鞋帽包包", "shirt"],
      ["食品酒水", "wine"],
      ["餐饮娱乐", "utensils"],
      ["餐饮食品", "utensils"]

  ];

  it("真实分类名都能推断出图标（兜底桶除外）", () => {
    cases.forEach(([name, expected]) => {
      expect(inferCategoryIcon(name), `分类「${name}」`).toBe(expected);
    });
  });

  it("兜底桶保持占位图标，不会被误配", () => {
    ["其他", "其他支出", "其他收入", "其他杂项", "专项支出", "未分类大额"].forEach((name) => {
      expect(inferCategoryIcon(name)).toBeNull();
    });
  });

  it("具体词优先于泛化词", () => {
    expect(inferCategoryIcon("咖啡")).toBe("coffee");
    expect(inferCategoryIcon("打车")).toBe("car-taxi-front");
    expect(inferCategoryIcon("地铁通勤")).toBe("tram-front");
    expect(inferCategoryIcon("加油")).toBe("fuel");
    expect(inferCategoryIcon("股票")).toBe("trending-up");
  });

  it("circle / folder / 空值都算未配图标，手选过的不算", () => {
    expect(isPlaceholderCategoryIcon("circle")).toBe(true);
    expect(isPlaceholderCategoryIcon("folder")).toBe(true);
    expect(isPlaceholderCategoryIcon("")).toBe(true);
    expect(isPlaceholderCategoryIcon(null)).toBe(true);
    expect(isPlaceholderCategoryIcon("utensils")).toBe(false);
  });
});

describe("版本更新探测（entryChunkFromIndexHtml）", () => {
  it("从 index.html 解析主入口 chunk 名", () => {
    expect(entryChunkFromIndexHtml('<script src="/assets/index-D0JzeQAq.js" defer></script>')).toBe("index-D0JzeQAq.js");
  });

  it("兼容 crossorigin / type=module / 相对路径", () => {
    expect(entryChunkFromIndexHtml('<script type="module" crossorigin src="./assets/index-abc123.js"></script>')).toBe("index-abc123.js");
    expect(entryChunkFromIndexHtml('<script src="https://ledger.example.com/assets/index-Xy9.js?t=1" defer></script>')).toBe("index-Xy9.js");
  });

  it("取不到返回 null（空串 / 无入口 script）", () => {
    expect(entryChunkFromIndexHtml("")).toBeNull();
    expect(entryChunkFromIndexHtml("<html><body>no script</body></html>")).toBeNull();
    expect(entryChunkFromIndexHtml('<script src="/assets/App-CDPhU4g-.js"></script>')).toBeNull();
  });
});
