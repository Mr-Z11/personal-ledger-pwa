import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { yuanToCents, monthKey, type Account, type Budget, type Category, type Transaction } from "@ledger/shared";
import {
  BigExpensePanel,
  BudgetReservoir,
  DailyPaceChart,
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
  salaryBannerState,
  saveFixedExpenses,
  saveSalarySettings
} from "./widgets";
import { PlanView, loadInsuranceSchedule, parseInsuranceText, saveInsuranceSchedule } from "./plan";

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

  it("PlanView 渲染预测 KPI、趋势图、主要支出项与预测依据", () => {
    const budgets: Budget[] = [
      { ...stamp, id: "b-total", month: monthOffsetKey(1), categoryId: null, amountCents: yuanToCents(9000), scope: "total" }
    ];
    const html = renderToString(<PlanView transactions={regularTransactions} categories={categories} budgets={budgets} />);
    expect(html).toContain("预测总支出");
    expect(html).toContain("预测日常消费");
    expect(html).toContain("主要支出项预测");
    expect(html).toContain("预测依据与计算过程");
    expect(html).toContain("plan-chart");
    expect(html).toContain("去年同期");
    expect(html).toContain("规划月份");
    expect(html).toContain('type="month"');
    expect(html).toContain("贷款本金");
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
    expect(html).toContain("保险缴费日历");
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

  it("FixedExpenseOverview 添加表单提供分类选择", () => {
    const html = renderToString(<FixedExpenseOverview transactions={[]} categories={categories} />);
    expect(html).toContain("关联分类（可选）");
    // 分类选择器列出账本里的分类（路径中的 > 在 HTML 中被转义，这里只校验分类名片段）
    expect(html).toContain("三餐");
    expect(html).toContain("贷款本金");
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
