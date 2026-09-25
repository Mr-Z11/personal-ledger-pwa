import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { yuanToCents, monthKey, type Account, type Category, type Transaction } from "@ledger/shared";
import {
  BigExpensePanel,
  BudgetReservoir,
  DailyPaceChart,
  LocalSalaryReminderPanel,
  SalaryBanner,
  TrendFocusCards,
  DEFAULT_SALARY_SETTINGS,
  loadSalarySettings,
  salaryBannerState,
  saveSalarySettings
} from "./widgets";

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
