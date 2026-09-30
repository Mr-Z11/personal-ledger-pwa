import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { yuanToCents, monthKey, type Account, type Budget, type Category, type Transaction } from "@ledger/shared";
import {
  BigExpensePanel,
  BudgetReservoir,
  DailyPaceChart,
  LocalSalaryReminderPanel,
  RegularExpensePanel,
  SalaryBanner,
  TrendFocusCards,
  DEFAULT_SALARY_SETTINGS,
  loadSalarySettings,
  salaryBannerState,
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
});
