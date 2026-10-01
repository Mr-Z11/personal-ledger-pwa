import { centsToYuan, monthKey, yuanToCents, type Budget, type Category, type Transaction } from "@ledger/shared";
import { useMemo, useState } from "react";
import {
  beijingDateTimeParts,
  categoryPath,
  dailyExpenseTransactions,
  dateKey,
  daysInMonth,
  monthBudgetTotal,
  monthLabel,
  monthTotalBudgetCents,
  offsetMonthKey,
  shortMonthLabel
} from "./utils";
import { collectRegularExpenses } from "./widgets";

/* ------------------------------------------------------------------ */
/* 规划页：基于历史数据 + 去年同期（主权重）的未来支出预测（纯规则，无 AI） */
/* ------------------------------------------------------------------ */

const PLAN_HISTORY = 6;
const PLAN_AHEAD = 3;
const PLAN_MAX_ITEMS = 8;
/** 去年同期权重（主），其余为近期趋势基准 */
const PLAN_LAST_YEAR_WEIGHT = 0.6;

export type PlanMonthPoint = {
  key: string;
  dailyCents: number;
  totalCents: number;
  isCurrent: boolean;
  /** 当月未结束：数值为「实际至今按日均投影到全月」的估计 */
  projected: boolean;
  actualSoFarCents: { daily: number; total: number } | null;
};

export type PlanForecast = {
  value: number;
  /** 去年同月实际值（无数据为 null） */
  lastYearCents: number | null;
  /** 近期基准 =（近3月均值 + 近6月均值）÷ 2 × 趋势因子 */
  recentBaseCents: number;
  low: number;
  high: number;
  avg3: number;
  avg6: number;
  trendFactor: number;
};

function sumMonth(transactions: Transaction[], key: string, dailyOnly: boolean, categories: Category[]) {
  const inMonth = transactions.filter((item) => item.type === "expense" && dateKey(item.occurredAt).startsWith(key));
  const scoped = dailyOnly ? dailyExpenseTransactions(inMonth, categories) : inMonth;
  return scoped.reduce((sum, item) => sum + item.amountCents, 0);
}

/** 近 N 个月（含当月）的日常消费/总支出序列；当月未结束时给出日均投影值 */
export function buildPlanHistory(transactions: Transaction[], categories: Category[], now = new Date()): PlanMonthPoint[] {
  const currentKey = monthKey(now);
  const today = Math.max(1, Number(beijingDateTimeParts(now).day));
  return Array.from({ length: PLAN_HISTORY }, (_, index) => {
    const key = offsetMonthKey(currentKey, -(PLAN_HISTORY - 1 - index));
    const isCurrent = key === currentKey;
    const dailyActual = sumMonth(transactions, key, true, categories);
    const totalActual = sumMonth(transactions, key, false, categories);
    if (!isCurrent) {
      return { key, dailyCents: dailyActual, totalCents: totalActual, isCurrent, projected: false, actualSoFarCents: null };
    }
    const days = daysInMonth(key);
    const projectedDaily = Math.round((dailyActual / today) * days);
    const projectedTotal = Math.round((totalActual / today) * days);
    return {
      key,
      dailyCents: projectedDaily,
      totalCents: projectedTotal,
      isCurrent,
      projected: today < days,
      actualSoFarCents: { daily: dailyActual, total: totalActual }
    };
  });
}

/**
 * 预测公式（以去年同期为主）：
 * - 近期基准 =（近3月均值 + 近6月均值）÷ 2 × 趋势因子（近3月均值 ÷ 前3月均值，限制 0.9~1.1）
 * - 有去年同期数据：预测 = 去年同期 × 60% + 近期基准 × 40%
 * - 无去年同期数据：预测 = 近期基准
 */
export function forecastFromHistory(values: number[], lastYearCents: number | null): PlanForecast | null {
  if (values.length < PLAN_HISTORY) return null;
  const recent = values.slice(-3);
  const earlier = values.slice(0, 3);
  const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const avg3 = mean(recent);
  const avg6 = mean(values);
  const prev3 = mean(earlier);
  const rawFactor = prev3 > 0 ? avg3 / prev3 : 1;
  const trendFactor = Math.min(1.1, Math.max(0.9, rawFactor));
  const recentBaseCents = Math.round(((avg3 + avg6) / 2) * trendFactor);
  const lastYear = lastYearCents !== null && lastYearCents > 0 ? lastYearCents : null;
  const value = lastYear !== null
    ? Math.round(lastYear * PLAN_LAST_YEAR_WEIGHT + recentBaseCents * (1 - PLAN_LAST_YEAR_WEIGHT))
    : recentBaseCents;
  const low = lastYear !== null ? Math.min(...values, lastYear) : Math.min(...values);
  const high = lastYear !== null ? Math.max(...values, lastYear) : Math.max(...values);
  return { value, lastYearCents: lastYear, recentBaseCents, low, high, avg3: Math.round(avg3), avg6: Math.round(avg6), trendFactor };
}

function compactYuan(cents: number) {
  const yuan = cents / 100;
  if (Math.abs(yuan) >= 10000) return `¥${(yuan / 10000).toFixed(1)}万`;
  return `¥${Math.round(yuan)}`;
}

/* ------------------------------------------------------------------ */
/* 保险缴费日历（本机 localStorage，不进仓库、不同步）                     */
/* ------------------------------------------------------------------ */

export type InsuranceItem = {
  id: string;
  name: string;
  /** 缴费月份 1-12 */
  month: number;
  amountCents: number;
  note?: string;
};

const INSURANCE_SCHEDULE_KEY = "ledger-insurance-schedule";

export function loadInsuranceSchedule(): InsuranceItem[] {
  try {
    const raw = localStorage.getItem(INSURANCE_SCHEDULE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<InsuranceItem>[];
    return parsed
      .filter((item) => item && typeof item.name === "string" && Number(item.month) >= 1 && Number(item.month) <= 12)
      .map((item, index) => ({
        id: typeof item.id === "string" ? item.id : `ins-${index}`,
        name: item.name as string,
        month: Number(item.month),
        amountCents: Math.max(0, Math.round(Number(item.amountCents) || 0)),
        note: typeof item.note === "string" ? item.note : undefined
      }));
  } catch {
    return [];
  }
}

export function saveInsuranceSchedule(items: InsuranceItem[]) {
  localStorage.setItem(INSURANCE_SCHEDULE_KEY, JSON.stringify(items));
}

/** 某月（"2026-11"）的日历保费合计 */
function scheduledInsuranceCents(items: InsuranceItem[], monthKeyValue: string) {
  const month = Number(monthKeyValue.slice(5, 7));
  return items.filter((item) => item.month === month).reduce((sum, item) => sum + item.amountCents, 0);
}

/** 历史保险月均：近 12 个月（含当月）保险类支出平均值（零月份计入，代表历史上的月均负担） */
function historyInsuranceMonthlyAvg(transactions: Transaction[], categories: Category[], endMonth: string) {
  let total = 0;
  for (let offset = 11; offset >= 0; offset -= 1) {
    const key = offsetMonthKey(endMonth, -offset);
    total += transactions
      .filter((item) => {
        if (item.type !== "expense" || !dateKey(item.occurredAt).startsWith(key)) return false;
        const category = categories.find((entry) => entry.id === item.categoryId);
        return /保险/.test(categoryPath(category, categories));
      })
      .reduce((sum, item) => sum + item.amountCents, 0);
  }
  return Math.round(total / 12);
}

/** 保险日历修正：预测总支出 = 原预测 − 历史保险月均 + 当月日历保费（下限为当月预测日常消费） */
function applyInsuranceAdjustment(totalCents: number, historyAvgCents: number, scheduledCents: number, dailyFloorCents: number) {
  return Math.max(dailyFloorCents, totalCents - historyAvgCents + scheduledCents);
}

function newInsuranceItem(): InsuranceItem {
  return { id: `ins-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "", month: 1, amountCents: 0 };
}

/** 解析粘贴文本：每行「月份 名称 金额」，如「11月 重疾险续费 4700」 */
export function parseInsuranceText(text: string): InsuranceItem[] {
  const items: InsuranceItem[] = [];
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(/^(\d{1,2})\s*月?\s*[、,，.\s]+\s*(.+?)\s+([\d,]+(?:\.\d+)?)\s*元?\s*$/);
    if (!match) return;
    const month = Number(match[1]);
    if (month < 1 || month > 12) return;
    const amount = Number(match[3].replace(/,/g, ""));
    if (!(amount > 0)) return;
    items.push({
      id: `ins-${month}-${items.length}-${Math.round(Math.random() * 1e6)}`,
      name: match[2].trim(),
      month,
      amountCents: Math.round(amount * 100)
    });
  });
  return items;
}

function InsuranceSchedulePanel({ items, futureKeys, onChange }: {
  items: InsuranceItem[];
  futureKeys: string[];
  onChange: (items: InsuranceItem[]) => void;
}) {
  const [draft, setDraft] = useState<InsuranceItem[]>(items);
  const [importText, setImportText] = useState("");
  const [saved, setSaved] = useState(false);
  const futurePremium = futureKeys.reduce((sum, key) => sum + scheduledInsuranceCents(items, key), 0);

  /** 编辑即存（静默）：只有名称+金额都有效的行才落库，输入中的半成品行留在草稿 */
  function persistSilent(next: InsuranceItem[]) {
    setDraft(next);
    const cleaned = next.filter((item) => item.name.trim() && item.amountCents > 0);
    onChange(cleaned);
    saveInsuranceSchedule(cleaned);
  }

  function updateRow(id: string, patch: Partial<InsuranceItem>) {
    persistSilent(draft.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function importAndSave() {
    const parsed = parseInsuranceText(importText);
    if (parsed.length === 0) return;
    setDraft(parsed);
    onChange(parsed);
    saveInsuranceSchedule(parsed);
    setImportText("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <details className="panel plan-insurance">
      <summary className="insights-fold-summary">
        <div>
          <h2>保险缴费日历（本机）</h2>
          <span>{items.length > 0 ? `${items.length} 项保单 · 未来3个月日历保费 ¥${centsToYuan(futurePremium)} · 点击管理` : "配置后，预测总支出会按缴费月份精确修正（只保存在本机）"}</span>
        </div>
        <em>{items.length > 0 ? "管理" : "去配置"}</em>
      </summary>
      <div className="plan-insurance-body">
        {draft.length > 0 && (
          <div className="plan-insurance-list">
            {draft.map((item) => (
              <div className="plan-insurance-row" key={item.id}>
                <select value={item.month} onChange={(event) => updateRow(item.id, { month: Number(event.target.value) })}>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>{month}月</option>
                  ))}
                </select>
                <input value={item.name} placeholder="保单名称" onChange={(event) => updateRow(item.id, { name: event.target.value })} />
                <input
                  value={item.amountCents > 0 ? String(item.amountCents / 100) : ""}
                  placeholder="金额（元/年）"
                  inputMode="decimal"
                  onChange={(event) => {
                    try {
                      updateRow(item.id, { amountCents: event.target.value ? yuanToCents(event.target.value) : 0 });
                    } catch {
                      // 输入过程中允许非法值，保存时过滤
                    }
                  }}
                />
                <button type="button" className="icon-button" title="删除" onClick={() => persistSilent(draft.filter((entry) => entry.id !== item.id))}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="data-actions">
          <button type="button" onClick={() => setDraft((current) => [...current, newInsuranceItem()])}>添加一行</button>
          {items.length > 0 && <span className="plan-autosave-note">修改自动保存</span>}
        </div>
        <label className="plan-insurance-import-label">批量导入（每行：月份 名称 金额）
          <textarea
            value={importText}
            rows={5}
            placeholder={"11月 重疾险续费 4000\n11月 百万医疗 700\n6月 重疾险 4056"}
            onChange={(event) => setImportText(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary plan-insurance-import-btn"
          disabled={!importText.trim()}
          onClick={importAndSave}
        >{saved ? `已保存（共 ${items.length} 项）` : `解析并保存${importText.trim() ? `（${importText.trim().split(/\r?\n/).filter(Boolean).length} 行）` : ""}`}</button>
        <p className="reminder-hint">只保存在本机（换设备需重新导入）。预测总支出 = 原预测 − 历史保险月均 + 当月日历保费；没有保单的月份（如 10 月、12 月）不会计入保险支出。</p>
      </div>
    </details>
  );
}

export function PlanView({ transactions, categories, budgets }: {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
}) {
  const now = useMemo(() => new Date(), []);
  const history = useMemo(() => buildPlanHistory(transactions, categories, now), [transactions, categories, now]);

  const currentKey = monthKey(now);
  const nextKey = offsetMonthKey(currentKey, 1);
  const futureKeys = useMemo(
    () => Array.from({ length: PLAN_AHEAD }, (_, index) => offsetMonthKey(currentKey, index + 1)),
    [currentKey]
  );

  const [insuranceItems, setInsuranceItems] = useState<InsuranceItem[]>(() => loadInsuranceSchedule());
  const scheduleConfigured = insuranceItems.length > 0;
  const histInsAvgCents = useMemo(
    () => historyInsuranceMonthlyAvg(transactions, categories, currentKey),
    [transactions, categories, currentKey]
  );

  /** 每个未来月份单独预测：去年同期（主权重）+ 近期基准；总支出再按保险缴费日历修正 */
  const forecasts = useMemo(() => futureKeys.map((key) => {
    const lastYearKey = offsetMonthKey(key, -12);
    const lastYearDaily = sumMonth(transactions, lastYearKey, true, categories);
    const lastYearTotal = sumMonth(transactions, lastYearKey, false, categories);
    const daily = forecastFromHistory(history.map((point) => point.dailyCents), lastYearDaily);
    const total = forecastFromHistory(history.map((point) => point.totalCents), lastYearTotal);
    const scheduledInsCents = scheduleConfigured ? scheduledInsuranceCents(insuranceItems, key) : null;
    const adjustedTotalCents = total && scheduledInsCents !== null
      ? applyInsuranceAdjustment(total.value, histInsAvgCents, scheduledInsCents, daily?.value ?? 0)
      : null;
    return {
      key,
      lastYearKey,
      lastYearDaily,
      lastYearTotal,
      daily,
      total,
      scheduledInsCents,
      adjustedTotalCents,
      shownTotalCents: adjustedTotalCents ?? total?.value ?? 0
    };
  }), [futureKeys, history, transactions, categories, insuranceItems, scheduleConfigured, histInsAvgCents]);

  const nextDailyForecast = forecasts[0]?.daily ?? null;
  const nextTotalForecast = forecasts[0]?.total ?? null;
  const nextShownTotalCents = forecasts[0]?.shownTotalCents ?? 0;

  const nextDailyBudget = monthBudgetTotal(budgets, nextKey);
  const nextTotalBudget = monthTotalBudgetCents(budgets, nextKey);

  const items = useMemo(() => {
    const { rows } = collectRegularExpenses(transactions, categories, currentKey);
    const predicted = rows.map((row) => {
      const total = row.monthly.reduce((sum, value) => sum + value, 0);
      return { name: row.name, predictedCents: Math.round(total / row.monthsHit), monthsHit: row.monthsHit };
    }).sort((left, right) => right.predictedCents - left.predictedCents);
    const fixedSum = predicted.reduce((sum, item) => sum + item.predictedCents, 0);
    return predicted.slice(0, PLAN_MAX_ITEMS).map((item) => ({
      ...item,
      share: fixedSum > 0 ? Math.round((item.predictedCents / fixedSum) * 100) : 0
    }));
  }, [transactions, categories, currentKey]);

  const fixedCents = items.reduce((sum, item) => sum + item.predictedCents, 0);
  const flexibleCents = nextTotalForecast ? Math.max(0, nextShownTotalCents - fixedCents) : 0;
  const specialForecastCents = nextDailyForecast && nextTotalForecast
    ? Math.max(0, nextShownTotalCents - nextDailyForecast.value)
    : 0;
  const hasData = history.some((point) => point.totalCents > 0);

  /* ---- 趋势图几何 ---- */
  const width = 680;
  const height = 300;
  const left = 64;
  const right = 14;
  const top = 26;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const groups = PLAN_HISTORY + PLAN_AHEAD;
  const groupW = innerW / groups;
  const barW = Math.min(22, groupW * 0.26);
  const allValues = [
    ...history.map((point) => point.totalCents),
    ...forecasts.flatMap((item) => item.total ? [item.shownTotalCents, item.total.high] : []),
    nextTotalBudget
  ];
  const maxY = Math.max(...allValues, 1) * 1.08;
  const xGroup = (index: number) => left + groupW * index + groupW / 2;
  const y = (value: number) => top + innerH - (value / maxY) * innerH;

  const futureStartX = left + groupW * PLAN_HISTORY;

  if (!hasData) {
    return (
      <section className="report-page plan-page">
        <div className="panel report-toolbar">
          <div>
            <h2>支出规划</h2>
            <span>暂无历史数据，记几笔账后这里会给出未来 {PLAN_AHEAD} 个月的支出预测</span>
          </div>
        </div>
      </section>
    );
  }

  const forecastComplete = forecasts.every((item) => item.daily && item.total);

  return (
    <section className="report-page plan-page">
      <div className="panel report-toolbar">
        <div>
          <h2>支出规划</h2>
          <span>基于近 {PLAN_HISTORY} 个月历史 + 去年同期（主权重 {Math.round(PLAN_LAST_YEAR_WEIGHT * 100)}%）· 预测未来 {PLAN_AHEAD} 个月的日常消费与总支出</span>
        </div>
      </div>

      <div className="plan-kpi-grid four">
        <article className="plan-kpi">
          <span>{monthLabel(nextKey)}预测总支出</span>
          <strong>{nextTotalForecast ? `¥${centsToYuan(nextShownTotalCents)}` : "数据不足"}</strong>
          <em>{nextTotalBudget > 0 && nextTotalForecast
            ? nextShownTotalCents > nextTotalBudget
              ? `比总开支预算多 ¥${centsToYuan(nextShownTotalCents - nextTotalBudget)}`
              : `在总开支预算内（余 ¥${centsToYuan(nextTotalBudget - nextShownTotalCents)}）`
            : nextTotalForecast?.lastYearCents
              ? `去年同期 ¥${centsToYuan(nextTotalForecast.lastYearCents)} · 历史区间 ${compactYuan(nextTotalForecast.low)} ~ ${compactYuan(nextTotalForecast.high)}`
              : "无去年同期对照"}</em>
          {scheduleConfigured && forecasts[0]?.scheduledInsCents !== null && (
            <em className="plan-kpi-ins">已按保险日历修正{forecasts[0]!.scheduledInsCents! > 0 ? `（含保费 ¥${centsToYuan(forecasts[0]!.scheduledInsCents!)}）` : "（本月无保费）"}</em>
          )}
        </article>
        <article className="plan-kpi">
          <span>其中预测日常消费</span>
          <strong>{nextDailyForecast ? `¥${centsToYuan(nextDailyForecast.value)}` : "数据不足"}</strong>
          <em>{nextDailyForecast
            ? `${nextDailyForecast.lastYearCents ? `去年同期 ¥${centsToYuan(nextDailyForecast.lastYearCents)} · ` : ""}历史区间 ${compactYuan(nextDailyForecast.low)} ~ ${compactYuan(nextDailyForecast.high)}`
            : "满 6 个月数据后生成"}</em>
        </article>
        <article className="plan-kpi">
          <span>其中预测专项支出</span>
          <strong>{nextDailyForecast && nextTotalForecast ? `¥${centsToYuan(specialForecastCents)}` : "数据不足"}</strong>
          <em>贷款、保险、教育等 · 总支出 − 日常消费</em>
        </article>
        <article className="plan-kpi">
          <span>预测固定支出项</span>
          <strong>¥{centsToYuan(fixedCents)}</strong>
          <em>{items.length} 个常规项 · 弹性消费约 ¥{centsToYuan(flexibleCents)}</em>
        </article>
      </div>

      <section className="panel">
        <div className="chart-heading">
          <h2>未来消费与总支出预测趋势</h2>
          <span>近 {PLAN_HISTORY} 个月实际 · 未来 {PLAN_AHEAD} 个月每月独立预测（去年同期 × {Math.round(PLAN_LAST_YEAR_WEIGHT * 100)}% + 近期基准 × {Math.round((1 - PLAN_LAST_YEAR_WEIGHT) * 100)}%）</span>
        </div>
        <div className="plan-chart-wrap">
          <svg className="plan-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="历史与未来支出预测趋势图">
            {[0, 0.5, 1].map((ratio) => (
              <g key={ratio}>
                <line className="plan-grid" x1={left} x2={width - right} y1={y(maxY * ratio)} y2={y(maxY * ratio)} />
                <text className="plan-axis" x={left - 8} y={y(maxY * ratio) + 4} textAnchor="end">{compactYuan(maxY * ratio)}</text>
              </g>
            ))}
            {/* 预测区域底色 */}
            <rect className="plan-forecast-zone" x={futureStartX} y={top} width={width - right - futureStartX} height={innerH} />
            <text className="plan-axis plan-forecast-tag" x={(futureStartX + width - right) / 2} y={top - 8} textAnchor="middle">预测</text>

            {history.map((point, index) => (
              <g key={point.key}>
                <rect className="plan-bar daily" x={xGroup(index) - barW - 2} y={y(point.dailyCents)} width={barW} height={top + innerH - y(point.dailyCents)} rx="3" />
                <rect className="plan-bar total" x={xGroup(index) + 2} y={y(point.totalCents)} width={barW} height={top + innerH - y(point.totalCents)} rx="3" />
                {point.projected && (
                  <text className="plan-axis plan-projected-tag" x={xGroup(index)} y={y(point.totalCents) - 6} textAnchor="middle">含预测</text>
                )}
                <text className="plan-axis" x={xGroup(index)} y={height - 18} textAnchor="middle">{shortMonthLabel(point.key)}</text>
              </g>
            ))}

            {forecastComplete && forecasts.map((item, offset) => {
              const index = PLAN_HISTORY + offset;
              const daily = item.daily!;
              const total = item.total!;
              const markX = xGroup(index) - barW - 2;
              return (
                <g key={item.key}>
                  <rect className="plan-bar daily forecast" x={xGroup(index) - barW - 2} y={y(daily.value)} width={barW} height={top + innerH - y(daily.value)} rx="3" />
                  <rect className="plan-bar total forecast" x={xGroup(index) + 2} y={y(item.shownTotalCents)} width={barW} height={top + innerH - y(item.shownTotalCents)} rx="3" />
                  <line className="plan-whisker" x1={xGroup(index) + 2 + barW / 2} x2={xGroup(index) + 2 + barW / 2} y1={y(total.low)} y2={y(total.high)} />
                  {total.lastYearCents !== null && (
                    <>
                      <path
                        className="plan-lastyear-mark"
                        d={`M ${markX - 5} ${y(total.lastYearCents) - 5} L ${markX} ${y(total.lastYearCents)} L ${markX - 5} ${y(total.lastYearCents) + 5} L ${markX - 10} ${y(total.lastYearCents)} Z`}
                      />
                      <text className="plan-axis plan-lastyear-tag" x={markX - 5} y={y(total.lastYearCents) - 7} textAnchor="middle">去年</text>
                    </>
                  )}
                  <text className="plan-axis plan-forecast-value" x={xGroup(index)} y={y(total.high) - 6} textAnchor="middle">{compactYuan(item.shownTotalCents)}</text>
                  <text className="plan-axis" x={xGroup(index)} y={height - 18} textAnchor="middle">{shortMonthLabel(item.key)}</text>
                </g>
              );
            })}

            {nextTotalBudget > 0 && (
              <g>
                <line className="plan-budget-line" x1={futureStartX} x2={width - right} y1={y(nextTotalBudget)} y2={y(nextTotalBudget)} />
                <text className="plan-axis plan-budget-tag" x={width - right - 4} y={y(nextTotalBudget) - 5} textAnchor="end">总开支预算 {compactYuan(nextTotalBudget)}</text>
              </g>
            )}
            {nextDailyBudget > 0 && (
              <g>
                <line className="plan-budget-line daily" x1={futureStartX} x2={width - right} y1={y(nextDailyBudget)} y2={y(nextDailyBudget)} />
                <text className="plan-axis plan-budget-tag" x={width - right - 4} y={y(nextDailyBudget) + 12} textAnchor="end">日常预算 {compactYuan(nextDailyBudget)}</text>
              </g>
            )}
          </svg>
        </div>
        <div className="pace-legend">
          <span><i className="pace-swatch plan-swatch-daily" />日常消费（实际）</span>
          <span><i className="pace-swatch plan-swatch-total" />总支出（实际）</span>
          <span><i className="pace-swatch plan-swatch-forecast" />未来预测</span>
          <span><i className="pace-swatch plan-swatch-lastyear" />去年同期参照</span>
        </div>
        <p className="plan-chart-note">每个未来月份按各自的去年同期独立预测（菱形标记 = 去年同月实际总支出，主权重 {Math.round(PLAN_LAST_YEAR_WEIGHT * 100)}%）；须线为近 {PLAN_HISTORY} 个月最低~最高区间。时间越远不确定性越大。</p>
      </section>

      <section className="panel">
        <div className="chart-heading">
          <h2>未来 {PLAN_AHEAD} 个月预测明细</h2>
          <span>每月的预测总支出及其构成 · 均以去年同期为主推算</span>
        </div>
        {forecastComplete ? (
          <div className="plan-month-table" role="table" aria-label="未来月份预测明细">
            {forecasts.map((item) => (
              <div className="plan-month-row" role="row" key={item.key}>
                <span className="plan-month-key">{monthLabel(item.key)}</span>
                <span className="plan-month-total"><em>预测总支出</em><b>¥{centsToYuan(item.shownTotalCents)}</b></span>
                <span><em>日常消费</em><b>¥{centsToYuan(item.daily!.value)}</b></span>
                <span><em>专项支出</em><b>¥{centsToYuan(Math.max(0, item.shownTotalCents - item.daily!.value))}</b></span>
                <span className="plan-month-ins"><em>保险日历</em><b>{item.scheduledInsCents === null ? "未配置" : item.scheduledInsCents > 0 ? `¥${centsToYuan(item.scheduledInsCents)}` : "无保费"}</b></span>
                <span className="plan-month-lastyear"><em>去年同期总支出</em><b>{item.total!.lastYearCents !== null ? `¥${centsToYuan(item.total!.lastYearCents)}` : "无记录"}</b></span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">历史数据不足 {PLAN_HISTORY} 个月，暂无法生成逐月预测明细。</p>
        )}
      </section>

      <InsuranceSchedulePanel
        items={insuranceItems}
        futureKeys={futureKeys}
        onChange={setInsuranceItems}
      />

      <section className="panel">
        <div className="chart-heading">
          <h2>{monthLabel(nextKey)}主要支出项预测</h2>
          <span>按近 {PLAN_HISTORY} 个月出现 ≥3 次的常规项推算 · 一眼看清钱花在哪</span>
        </div>
        {items.length === 0 ? (
          <p className="empty">历史数据中还识别不出固定支出项，继续记账后自动生成。</p>
        ) : (
          <div className="plan-item-list">
            {items.map((item) => (
              <div className="plan-item-row" key={item.name}>
                <div className="plan-item-main">
                  <strong>{item.name}</strong>
                  <span>近6个月 {item.monthsHit} 次 · 占固定项 {item.share}%</span>
                </div>
                <div className="plan-item-amount">
                  <strong>¥{centsToYuan(item.predictedCents)}</strong>
                  <div className="bar"><i style={{ width: `${Math.max(4, item.share)}%` }} /></div>
                </div>
              </div>
            ))}
            <div className="plan-item-row flexible">
              <div className="plan-item-main">
                <strong>弹性消费（餐饮、购物、娱乐等）</strong>
                <span>预测总支出 − 固定项合计</span>
              </div>
              <div className="plan-item-amount">
                <strong>¥{centsToYuan(flexibleCents)}</strong>
                <div className="bar"><i style={{ width: `${nextTotalForecast && nextShownTotalCents > 0 ? Math.max(4, Math.round((flexibleCents / nextShownTotalCents) * 100)) : 4}%` }} /></div>
              </div>
            </div>
          </div>
        )}
      </section>

      <details className="panel plan-evidence">
        <summary className="insights-fold-summary">
          <div>
            <h2>预测依据与计算过程</h2>
            <span>所有预测数字都能在这里找到出处，点击展开</span>
          </div>
          <em>展开</em>
        </summary>
        <div className="plan-evidence-body">
          <h3>1. 数据窗口：近 {PLAN_HISTORY} 个月实际流水</h3>
          <div className="plan-evidence-table-wrap">
            <table className="plan-evidence-table">
              <thead>
                <tr><th>月份</th><th>日常消费</th><th>总支出</th><th>说明</th></tr>
              </thead>
              <tbody>
                {history.map((point) => (
                  <tr key={point.key}>
                    <td>{monthLabel(point.key)}</td>
                    <td>¥{centsToYuan(point.dailyCents)}</td>
                    <td>¥{centsToYuan(point.totalCents)}</td>
                    <td>{point.projected && point.actualSoFarCents
                      ? `当月未结束：实际 ¥${centsToYuan(point.actualSoFarCents.total)}，按日均投影全月`
                      : "实际发生"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>2. 去年同期数据（主权重依据）</h3>
          <div className="plan-evidence-table-wrap">
            <table className="plan-evidence-table">
              <thead>
                <tr><th>预测月份</th><th>去年同期</th><th>日常消费</th><th>总支出</th></tr>
              </thead>
              <tbody>
                {forecasts.map((item) => (
                  <tr key={item.key}>
                    <td>{monthLabel(item.key)}</td>
                    <td>{monthLabel(item.lastYearKey)}</td>
                    <td>{item.lastYearDaily > 0 ? `¥${centsToYuan(item.lastYearDaily)}` : "无记录"}</td>
                    <td>{item.lastYearTotal > 0 ? `¥${centsToYuan(item.lastYearTotal)}` : "无记录"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="plan-evidence-note">去年同期是最重要的参照：同样的月份往往有同样的季节性开销（双 11、年末、开学、保费续期等）。有去年同期数据时它占预测的 {Math.round(PLAN_LAST_YEAR_WEIGHT * 100)}%。</p>
          <h3>3. 预测公式（日常消费与总支出分别计算）</h3>
          {nextDailyForecast && nextTotalForecast ? (
            <ul>
              <li>近期基准 =（近3个月均值 + 近{PLAN_HISTORY}个月均值）÷ 2 × 趋势因子；趋势因子 = 近3个月均值 ÷ 前3个月均值（限制 0.9 ~ 1.1，防止单月暴涨暴跌带偏），代表近期消费水平的走向</li>
              <li>预测值 = 去年同期 × {PLAN_LAST_YEAR_WEIGHT} + 近期基准 × {(1 - PLAN_LAST_YEAR_WEIGHT).toFixed(1)}；例如 {monthLabel(nextKey)}总支出 = {nextTotalForecast.lastYearCents !== null ? `¥${centsToYuan(nextTotalForecast.lastYearCents)} × ${PLAN_LAST_YEAR_WEIGHT} + ` : "（无去年同期，全额用近期基准）"}¥{centsToYuan(nextTotalForecast.recentBaseCents)} × {(1 - PLAN_LAST_YEAR_WEIGHT).toFixed(1)} = ¥{centsToYuan(nextTotalForecast.value)}</li>
              <li>无去年同期记录的月份退化为全额近期基准</li>
              <li>预测区间 = 近 {PLAN_HISTORY} 个月实际值与去年同期的最低 ~ 最高（图中的须线）</li>
              <li>专项支出预测 = 预测总支出 − 预测日常消费（贷款、保险、教育等固定专项大多已含在常规项中）</li>
            </ul>
          ) : (
            <p>历史数据不足 {PLAN_HISTORY} 个月，暂无法生成公式化预测。</p>
          )}
          <h3>4. 保险缴费日历修正{scheduleConfigured ? "（已生效）" : "（未配置）"}</h3>
          <ul>
            {scheduleConfigured ? (
              <>
                <li>历史保险月均（近12个月保险类支出平均）= ¥{centsToYuan(histInsAvgCents)}</li>
                <li>修正公式：预测总支出 = 原预测 − 历史保险月均 + 当月日历保费（下限为当月预测日常消费）；{futureKeys.map((key) => `${monthLabel(key)}日历保费 ¥${centsToYuan(scheduledInsuranceCents(insuranceItems, key))}`).join("，")}</li>
                <li>没有保单的月份日历保费为 0，保险支出即被剔除——保险只在缴费月出现</li>
              </>
            ) : (
              <li>在上方「保险缴费日历」配置各保单的缴费月份与金额后，预测总支出会按缴费月份精确修正（保险是刚性年度支出，只在缴费月发生，用日历比用历史平均准确得多）</li>
            )}
          </ul>
          <h3>5. 主要支出项识别规则</h3>
          <ul>
            <li>同一支出分类近 {PLAN_HISTORY} 个月出现 ≥3 个月 → 判定为常规项（含贷款、保险等固定专项）</li>
            <li>预测金额 = 该分类在「有支出的月份」的平均值（没出现的月份不计入，避免低估固定开销）</li>
            <li>弹性消费 = 预测总支出 − 常规项合计，代表餐饮、购物、娱乐等可压缩空间</li>
          </ul>
          <p className="plan-evidence-disclaimer">说明：以上全部为纯统计规则（去年同期加权 + 均值 + 趋势限制 + 频率识别），不预测一次性大额支出（如旅游、家电、人情），请把这类计划内开销自行加到预测值上。</p>
        </div>
      </details>
    </section>
  );
}
