import { centsToYuan, monthKey, yuanToCents, type Account, type Category, type Transaction } from "@ledger/shared";
import { BellRing, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { useId, useMemo, useState, type CSSProperties } from "react";
import {
  beijingDateTimeParts,
  categoryPath,
  dailyExpenseTransactions,
  dateKey,
  daysInMonth,
  monthLabel,
  offsetMonthKey,
  percentDelta,
  previousMonthKeys
} from "./utils";

/* ------------------------------------------------------------------ */
/* 工资日提醒（纯本地，离线可用）                                        */
/* ------------------------------------------------------------------ */

export type SalarySettings = {
  enabled: boolean;
  day: number;
  leadDays: number;
  content: string;
  notify: boolean;
};

const SALARY_SETTINGS_KEY = "ledger-salary-reminder";
const SALARY_DISMISS_KEY = "ledger-salary-dismissed";
const SALARY_NOTIFY_KEY = "ledger-salary-notified";

export const DEFAULT_SALARY_SETTINGS: SalarySettings = {
  enabled: false,
  day: 10,
  leadDays: 3,
  content: "",
  notify: false
};

export function loadSalarySettings(): SalarySettings {
  try {
    const raw = localStorage.getItem(SALARY_SETTINGS_KEY);
    if (!raw) return DEFAULT_SALARY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SalarySettings>;
    return {
      enabled: Boolean(parsed.enabled),
      day: Math.min(31, Math.max(1, Number(parsed.day) || 10)),
      leadDays: Math.min(7, Math.max(0, Number(parsed.leadDays) || 0)),
      content: typeof parsed.content === "string" ? parsed.content : "",
      notify: Boolean(parsed.notify)
    };
  } catch {
    return DEFAULT_SALARY_SETTINGS;
  }
}

export function saveSalarySettings(settings: SalarySettings) {
  localStorage.setItem(SALARY_SETTINGS_KEY, JSON.stringify(settings));
}

function effectiveSalaryDay(day: number, month: string) {
  return Math.min(day, daysInMonth(month));
}

function nextPaydayInfo(settings: SalarySettings, now = new Date()) {
  const thisMonth = monthKey(now);
  const today = now.getDate();
  const thisDay = effectiveSalaryDay(settings.day, thisMonth);
  if (today <= thisDay) {
    return { month: thisMonth, day: thisDay, daysLeft: thisDay - today };
  }
  const nextMonth = offsetMonthKey(thisMonth, 1);
  const nextDay = effectiveSalaryDay(settings.day, nextMonth);
  const daysLeft = daysInMonth(thisMonth) - today + nextDay;
  return { month: nextMonth, day: nextDay, daysLeft };
}

export type SalaryBannerState =
  | { kind: "payday"; content: string }
  | { kind: "countdown"; daysLeft: number; label: string };

export function salaryBannerState(settings: SalarySettings, dismissedKey: string | null): SalaryBannerState | null {
  if (!settings.enabled) return null;
  const info = nextPaydayInfo(settings);
  const todayKey = dateKey(new Date().toISOString());
  if (info.daysLeft === 0) {
    if (dismissedKey === todayKey) return null;
    return { kind: "payday", content: settings.content };
  }
  if (info.daysLeft <= settings.leadDays) {
    if (dismissedKey === todayKey) return null;
    return { kind: "countdown", daysLeft: info.daysLeft, label: `${monthLabel(info.month)}${info.day}日` };
  }
  return null;
}

export function dismissSalaryBannerForToday() {
  localStorage.setItem(SALARY_DISMISS_KEY, dateKey(new Date().toISOString()));
}

export function salaryBannerDismissedKey() {
  return localStorage.getItem(SALARY_DISMISS_KEY);
}

/** 工资日当天如开启本地通知且未通知过，则发一条系统通知（失败静默降级为横幅） */
export function maybeNotifyPayday(settings: SalarySettings) {
  if (!settings.enabled || !settings.notify) return;
  if (nextPaydayInfo(settings).daysLeft !== 0) return;
  const todayKey = dateKey(new Date().toISOString());
  if (localStorage.getItem(SALARY_NOTIFY_KEY) === todayKey) return;
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification("今天是工资日", {
      body: settings.content.trim() || "工资到账啦，记得按方案分配资金。"
    });
    localStorage.setItem(SALARY_NOTIFY_KEY, todayKey);
  } catch {
    // 部分平台（如 iOS Safari）不支持本地 Notification，忽略即可
  }
}

export function SalaryBanner({ state, onDismiss }: { state: SalaryBannerState; onDismiss: () => void }) {
  return (
    <div className={`salary-banner ${state.kind}`}>
      <BellRing size={18} />
      <div className="salary-banner-body">
        {state.kind === "payday" ? (
          <>
            <strong>今天是工资日</strong>
            <span>{state.content.trim() || "工资到账啦，记得按方案分配资金。"}</span>
          </>
        ) : (
          <>
            <strong>距离发工资还有 {state.daysLeft} 天</strong>
            <span>预计 {state.label} 到账{state.daysLeft <= 1 ? "，留意余额安排" : ""}</span>
          </>
        )}
      </div>
      <button type="button" className="icon-button" onClick={onDismiss} title="今天不再提示">
        <X size={16} />
      </button>
    </div>
  );
}

export function LocalSalaryReminderPanel({ value, onChange }: {
  value: SalarySettings;
  onChange: (settings: SalarySettings) => void;
}) {
  const [draft, setDraft] = useState<SalarySettings>(value);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const changed = JSON.stringify(draft) !== JSON.stringify(value);

  async function toggleNotify(notify: boolean) {
    if (notify && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setDraft((current) => ({ ...current, notify: false }));
        return;
      }
    }
    setDraft((current) => ({ ...current, notify }));
  }

  return (
    <div className="reminder-panel form-stack">
      <div className={`reminder-status ${value.enabled ? "on" : ""}`}>
        <BellRing size={16} />
        <span>{value.enabled ? `已开启：每月 ${value.day} 日提醒，提前 ${value.leadDays} 天倒计时` : "未开启"}</span>
      </div>
      <div className="reminder-row">
        <label>工资日
          <select value={draft.day} onChange={(event) => setDraft({ ...draft, day: Number(event.target.value) })}>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>{day} 日</option>
            ))}
          </select>
        </label>
        <label>提前倒计时
          <select value={draft.leadDays} onChange={(event) => setDraft({ ...draft, leadDays: Number(event.target.value) })}>
            {Array.from({ length: 8 }, (_, index) => index).map((days) => (
              <option key={days} value={days}>{days === 0 ? "仅当天" : `提前 ${days} 天`}</option>
            ))}
          </select>
        </label>
      </div>
      <label>提醒内容（可写资金分配方案）
        <textarea
          value={draft.content}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })}
          rows={4}
          maxLength={1000}
          placeholder={"例如：\n工资到账啦，按方案分配：\n1. 固定储蓄 50%\n2. 日常开销 30%\n3. 投资理财 20%"}
        />
      </label>
      <label className="reminder-toggle">
        <input type="checkbox" checked={draft.notify} onChange={(event) => void toggleNotify(event.target.checked)} />
        同时发送系统通知（打开应用时触发，纯本地不经过服务器）
      </label>
      <div className="data-actions">
        {draft.enabled ? (
          <button type="button" onClick={() => { const next = { ...draft, enabled: false }; setDraft(next); onChange(next); }}>关闭提醒</button>
        ) : (
          <button className="primary" type="button" onClick={() => { const next = { ...draft, enabled: true }; setDraft(next); onChange(next); }}>
            <BellRing size={16} />开启提醒
          </button>
        )}
        <button type="button" disabled={!changed} onClick={() => { onChange(draft); setSaved(true); window.setTimeout(() => setSaved(false), 2000); }}>
          {saved ? "已保存" : "保存设置"}
        </button>
      </div>
      {permission === "denied" && <p className="reminder-hint warn">系统通知权限已被拒绝：可在系统设置中允许通知；即使不开通知，应用内横幅提醒依然有效。</p>}
      <p className="reminder-hint">提醒完全保存在本机（离线、无服务器也能用）。打开应用时若到了工资日或倒计时范围内，首页顶部会显示横幅。当月没有 31 日时自动在当月最后一天提醒。</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 蓄水池预算可视化                                                    */
/* ------------------------------------------------------------------ */

const WAVE_PATH_A = "M -200 8 Q -175 -2 -150 8 T -100 8 T -50 8 T 0 8 T 50 8 T 100 8 T 150 8 T 200 8 L 200 260 L -200 260 Z";
const WAVE_PATH_B = "M -200 10 Q -180 0 -160 10 T -120 10 T -80 10 T -40 10 T 0 10 T 40 10 T 80 10 T 120 10 T 160 10 T 200 10 L 200 260 L -200 260 Z";

export function BudgetReservoir({ title, note, spentCents, budgetCents, accent }: {
  title: string;
  note?: string;
  spentCents: number;
  budgetCents: number;
  accent: string;
}) {
  const clipId = useId();
  const ratio = budgetCents > 0 ? spentCents / budgetCents : 0;
  const fillPct = Math.min(100, Math.max(0, ratio * 100));
  const over = budgetCents > 0 && spentCents > budgetCents;
  const today = Number(beijingDateTimeParts().day);
  const totalDays = daysInMonth(monthKey());
  const daysLeft = Math.max(1, totalDays - today + 1);
  const remainingCents = Math.max(0, budgetCents - spentCents);
  const allowanceCents = budgetCents > 0 ? Math.round(remainingCents / daysLeft) : 0;
  const waterY = 224 - (fillPct / 100) * 210;
  const waterColor = over ? "#c0392b" : ratio > 0.85 ? "#d4882f" : accent;

  if (budgetCents <= 0) {
    return (
      <article className="reservoir-card">
        <header className="reservoir-head">
          <strong>{title}</strong>
          {note && <span>{note}</span>}
        </header>
        <div className="reservoir-tank empty">
          <svg viewBox="0 0 200 250" role="img" aria-label={`${title}未设置预算`}>
            <rect className="reservoir-outline empty-outline" x="30" y="14" width="140" height="210" rx="16" />
          </svg>
          <div className="reservoir-center">
            <strong>未设预算</strong>
            <span>本月已花 ¥{centsToYuan(spentCents)}</span>
            <em>设置 → 预算管理</em>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={`reservoir-card ${over ? "over" : ""}`}>
      <header className="reservoir-head">
        <strong>{title}</strong>
        {note && <span>{note}</span>}
      </header>
      <div className="reservoir-tank">
        <svg viewBox="0 0 200 250" role="img" aria-label={`${title}已用 ${Math.round(ratio * 100)}%`}>
          <defs>
            <clipPath id={clipId}>
              <rect x="32" y="16" width="136" height="206" rx="14" />
            </clipPath>
          </defs>
          <rect className="reservoir-backdrop" x="30" y="14" width="140" height="210" rx="16" />
          <g clipPath={`url(#${clipId})`}>
            <g className="reservoir-water" style={{ transform: `translateY(${waterY - 8}px)` }}>
              <path className="reservoir-wave-a" d={WAVE_PATH_A} fill={waterColor} opacity="0.9" />
              <path className="reservoir-wave-b" d={WAVE_PATH_B} fill={waterColor} opacity="0.45" />
            </g>
          </g>
          <rect className="reservoir-outline" x="30" y="14" width="140" height="210" rx="16" />
        </svg>
        <div className="reservoir-center">
          <strong>{Math.round(ratio * 100)}%</strong>
          <span>¥{centsToYuan(spentCents)} / ¥{centsToYuan(budgetCents)}</span>
          {over && <em className="reservoir-over-badge">超支 ¥{centsToYuan(spentCents - budgetCents)}</em>}
        </div>
      </div>
      <footer className="reservoir-foot">
        {over ? (
          <span>已超支，剩余 {daysLeft} 天需零消费才能回到线内</span>
        ) : (
          <span>剩余 ¥{centsToYuan(remainingCents)} · {daysLeft} 天 · 每天还可花 ¥{centsToYuan(allowanceCents)}</span>
        )}
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 消费节奏图：每日累计 vs 预算平均线                                    */
/* ------------------------------------------------------------------ */

function cumulativeDailyExpenses(transactions: Transaction[], categories: Category[], month: string, uptoDay?: number) {
  const days = daysInMonth(month);
  const perDay = new Array<number>(days + 1).fill(0);
  dailyExpenseTransactions(transactions, categories).forEach((item) => {
    const key = dateKey(item.occurredAt);
    if (!key.startsWith(month)) return;
    const day = Number(key.slice(8, 10));
    if (day >= 1 && day <= days) perDay[day] += item.amountCents;
  });
  const limit = Math.min(uptoDay ?? days, days);
  const cumulative: number[] = [0];
  let running = 0;
  for (let day = 1; day <= days; day += 1) {
    if (day <= limit) running += perDay[day];
    cumulative.push(running);
  }
  return cumulative;
}

export function DailyPaceChart({ month, transactions, categories, budgetCents }: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  budgetCents: number;
}) {
  const isCurrent = month === monthKey();
  const days = daysInMonth(month);
  const today = isCurrent ? Number(beijingDateTimeParts().day) : days;
  const monthTransactions = useMemo(
    () => transactions.filter((item) => item.occurredAt.startsWith(month)),
    [transactions, month]
  );
  const prevMonth = offsetMonthKey(month, -1);
  const prevTransactions = useMemo(
    () => transactions.filter((item) => item.occurredAt.startsWith(prevMonth)),
    [transactions, prevMonth]
  );
  const cumulative = useMemo(
    () => cumulativeDailyExpenses(monthTransactions, categories, month, today),
    [monthTransactions, categories, month, today]
  );
  const prevCumulative = useMemo(
    () => cumulativeDailyExpenses(prevTransactions, categories, prevMonth),
    [prevTransactions, categories, prevMonth]
  );

  const spentToday = cumulative[today];
  const dailyAverage = today > 0 ? Math.round(spentToday / today) : 0;
  const projected = dailyAverage * days;
  const paceToday = budgetCents > 0 ? Math.round((budgetCents / days) * today) : 0;
  const paceDelta = spentToday - paceToday;
  const prevAtSameDay = prevCumulative[Math.min(today, daysInMonth(prevMonth))];
  const maxY = Math.max(budgetCents, projected, spentToday, prevAtSameDay, 1) * 1.08;

  const width = 680;
  const height = 260;
  const left = 66;
  const right = 14;
  const top = 14;
  const bottom = 30;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const x = (day: number) => left + (day / days) * innerW;
  const y = (value: number) => top + innerH - (value / maxY) * innerH;

  const actualPoints: string[] = [`${x(0)},${y(0)}`];
  for (let day = 1; day <= today; day += 1) actualPoints.push(`${x(day)},${y(cumulative[day])}`);
  const prevPoints: string[] = [`${x(0)},${y(0)}`];
  for (let day = 1; day <= days; day += 1) prevPoints.push(`${x(day)},${y(prevCumulative[day])}`);
  const areaPoints = `${actualPoints.join(" ")} ${x(today)},${y(0)}`;

  const compactYuan = (cents: number) => {
    const yuan = cents / 100;
    if (Math.abs(yuan) >= 10000) return `¥${(yuan / 10000).toFixed(1)}万`;
    return `¥${Math.round(yuan)}`;
  };
  const dayTicks = [1, 5, 10, 15, 20, 25, days].filter((value, index, list) => list.indexOf(value) === index);

  return (
    <div className="pace-chart-wrap">
      <div className={`pace-status ${budgetCents > 0 ? (paceDelta > 0 ? "over" : "under") : ""}`}>
        {budgetCents > 0 ? (
          paceDelta > 0 ? (
            <span>日均 ¥{centsToYuan(dailyAverage)}，<b>超出预算平均线 ¥{centsToYuan(paceDelta)}</b>，照此节奏月底约 ¥{centsToYuan(projected)}</span>
          ) : (
            <span>日均 ¥{centsToYuan(dailyAverage)}，<b>低于预算平均线 ¥{centsToYuan(Math.abs(paceDelta))}</b>，节奏良好</span>
          )
        ) : (
          <span>日均 ¥{centsToYuan(dailyAverage)}，未设日常预算，无法对比平均线（设置 → 预算管理）</span>
        )}
      </div>
      <svg className="pace-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="本月每日累计消费与预算平均线对比">
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line className="pace-grid" x1={left} x2={width - right} y1={y(maxY * ratio)} y2={y(maxY * ratio)} />
            <text className="pace-axis-label" x={left - 8} y={y(maxY * ratio) + 4} textAnchor="end">{compactYuan(maxY * ratio)}</text>
          </g>
        ))}
        {dayTicks.map((day) => (
          <text key={day} className="pace-axis-label" x={x(day)} y={height - 8} textAnchor="middle">{day}日</text>
        ))}
        {budgetCents > 0 && (
          <line className="pace-budget-line" x1={x(0)} y1={y(0)} x2={x(days)} y2={y(budgetCents)} />
        )}
        <polyline className="pace-prev-line" points={prevPoints.join(" ")} />
        {today > 0 && spentToday > 0 && (
          <polygon className="pace-area" points={areaPoints} />
        )}
        <polyline className="pace-actual-line" points={actualPoints.join(" ")} />
        {isCurrent && today < days && dailyAverage > 0 && (
          <line className="pace-projection-line" x1={x(today)} y1={y(spentToday)} x2={x(days)} y2={y(projected)} />
        )}
        {isCurrent && (
          <line className="pace-today-line" x1={x(today)} x2={x(today)} y1={top} y2={top + innerH} />
        )}
        {today > 0 && (
          <circle
            className={`pace-today-dot ${paceDelta > 0 && budgetCents > 0 ? "over" : ""}`}
            cx={x(today)}
            cy={y(spentToday)}
            r="4.5"
          />
        )}
      </svg>
      <div className="pace-legend">
        <span><i className="pace-swatch actual" />本月累计</span>
        <span><i className="pace-swatch prev" />上月累计</span>
        {budgetCents > 0 && <span><i className="pace-swatch budget" />预算平均线</span>}
        {isCurrent && <span><i className="pace-swatch projection" />按当前节奏预测</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 趋势焦点卡：环比 / 同比 / 近3月趋势                                   */
/* ------------------------------------------------------------------ */

function sumCents(transactions: Transaction[]) {
  return transactions.reduce((sum, item) => sum + item.amountCents, 0);
}

function TrendIcon({ delta }: { delta: number }) {
  if (delta > 0) return <TrendingUp size={15} />;
  if (delta < 0) return <TrendingDown size={15} />;
  return <Minus size={15} />;
}

export function TrendFocusCards({ month, transactions, categories, budgetCents }: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  budgetCents: number;
}) {
  const isCurrent = month === monthKey();
  const days = daysInMonth(month);
  const elapsed = isCurrent ? Math.max(1, Number(beijingDateTimeParts().day)) : days;

  const dailyInRange = (key: string, uptoDay?: number) => dailyExpenseTransactions(
    transactions.filter((item) => {
      if (!item.occurredAt.startsWith(key)) return false;
      if (uptoDay === undefined) return true;
      return Number(dateKey(item.occurredAt).slice(8, 10)) <= uptoDay;
    }),
    categories
  );

  const currentCents = sumCents(dailyInRange(month, isCurrent ? elapsed : undefined));
  const currentDailyAvg = Math.round(currentCents / elapsed);

  const prevKey = offsetMonthKey(month, -1);
  const prevCents = sumCents(dailyInRange(prevKey, isCurrent ? elapsed : undefined));
  const prevDailyAvg = Math.round(prevCents / elapsed);
  const momDelta = prevCents > 0 ? percentDelta(currentCents, prevCents) : null;

  const [yearPart, monthPart] = month.split("-").map(Number);
  const lastYearKey = `${yearPart - 1}-${String(monthPart).padStart(2, "0")}`;
  const lastYearCents = sumCents(dailyInRange(lastYearKey, isCurrent ? elapsed : undefined));
  const yoyDelta = lastYearCents > 0 ? percentDelta(currentCents, lastYearCents) : null;

  const recentKeys = previousMonthKeys(month, 3);
  const earlierKeys = previousMonthKeys(offsetMonthKey(month, -3), 3);
  const perDayAverage = (keys: string[]) => {
    const totalCents = keys.reduce((sum, key) => sum + sumCents(dailyInRange(key)), 0);
    const totalDays = keys.reduce((sum, key) => sum + daysInMonth(key), 0);
    return totalDays > 0 ? totalCents / totalDays : 0;
  };
  const recentAvg = perDayAverage(recentKeys);
  const earlierAvg = perDayAverage(earlierKeys);
  const trendDelta = earlierAvg > 0 ? Math.round(((recentAvg - earlierAvg) / earlierAvg) * 100) : null;
  const trendLabel = trendDelta === null ? "数据不足" : Math.abs(trendDelta) < 5 ? "基本持平" : trendDelta > 0 ? "上升趋势" : "下降趋势";

  const budgetDailyAvg = budgetCents > 0 ? Math.round(budgetCents / days) : 0;
  const budgetDelta = budgetDailyAvg > 0 ? Math.round(((currentDailyAvg - budgetDailyAvg) / budgetDailyAvg) * 100) : null;

  const deltaText = (delta: number | null) => delta === null ? "无对照数据" : `${delta > 0 ? "+" : ""}${delta}%`;
  const toneOf = (delta: number | null) => delta === null ? "" : delta > 5 ? "up" : delta < -5 ? "down" : "flat";

  return (
    <div className="trend-focus-grid">
      <article className={`trend-focus-card ${toneOf(momDelta)}`}>
        <span>环比（vs 上月同期）</span>
        <strong>{deltaText(momDelta)}</strong>
        <em><TrendIcon delta={momDelta ?? 0} />本月日均 ¥{centsToYuan(currentDailyAvg)} · 上月日均 ¥{centsToYuan(prevDailyAvg)}</em>
      </article>
      <article className={`trend-focus-card ${toneOf(yoyDelta)}`}>
        <span>同比（vs 去年同月）</span>
        <strong>{deltaText(yoyDelta)}</strong>
        <em><TrendIcon delta={yoyDelta ?? 0} />{lastYearCents > 0 ? `去年同期 ¥${centsToYuan(lastYearCents)}` : "去年同月无记录"}</em>
      </article>
      <article className={`trend-focus-card ${toneOf(trendDelta)}`}>
        <span>近3月消费趋势</span>
        <strong>{trendLabel}</strong>
        <em><TrendIcon delta={trendDelta ?? 0} />{trendDelta === null ? "满 6 个月数据后自动判定" : `较前3个月 ${trendDelta > 0 ? "+" : ""}${trendDelta}%`}</em>
      </article>
      <article className={`trend-focus-card ${toneOf(budgetDelta)}`}>
        <span>日均 vs 预算日均线</span>
        <strong>{budgetDelta === null ? "未设预算" : deltaText(budgetDelta)}</strong>
        <em><TrendIcon delta={budgetDelta ?? 0} />{budgetDelta === null ? "设置日常预算后自动对比" : `预算日均 ¥${centsToYuan(budgetDailyAvg)} · 实际日均 ¥${centsToYuan(currentDailyAvg)}`}</em>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 大额开销分析（纯规则算法）                                            */
/* ------------------------------------------------------------------ */

const BIG_EXPENSE_THRESHOLD_KEY = "ledger-big-expense-threshold";

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

type BigExpenseRow = {
  transaction: Transaction;
  amountCents: number;
  share: number;
  categoryLabel: string;
  accountLabel: string;
  noteLabel: string;
  badge: { kind: "recurring" | "new" | "none"; text: string };
};

export function BigExpensePanel({ month, transactions, categories, accounts }: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
}) {
  const [thresholdInput, setThresholdInput] = useState(() => localStorage.getItem(BIG_EXPENSE_THRESHOLD_KEY) ?? "1000");

  const monthExpenses = useMemo(
    () => transactions.filter((item) => item.type === "expense" && item.occurredAt.startsWith(month)),
    [transactions, month]
  );
  const totalCents = sumCents(monthExpenses);

  const userThresholdCents = useMemo(() => {
    try {
      const cents = yuanToCents(thresholdInput || "1000");
      return cents > 0 ? cents : 100_000;
    } catch {
      return 100_000;
    }
  }, [thresholdInput]);

  const amounts = monthExpenses.map((item) => item.amountCents);
  const autoThresholdCents = amounts.length >= 8 ? Math.round(median(amounts) * 3) : 0;
  const effectiveThresholdCents = Math.max(userThresholdCents, autoThresholdCents);
  const autoApplied = autoThresholdCents > userThresholdCents;

  const historyKeys = useMemo(() => [month, ...previousMonthKeys(month, 5)], [month]);
  const historyByGroup = useMemo(() => {
    const map = new Map<string, { months: Set<string>; days: number[]; amounts: number[] }>();
    transactions.forEach((item) => {
      if (item.type !== "expense" || item.amountCents < effectiveThresholdCents) return;
      const key = dateKey(item.occurredAt);
      const itemMonth = key.slice(0, 7);
      if (!historyKeys.includes(itemMonth)) return;
      const category = categories.find((entry) => entry.id === item.categoryId);
      const groupKey = item.merchant?.trim() || categoryPath(category, categories) || "未分类";
      const entry = map.get(groupKey) ?? { months: new Set<string>(), days: [], amounts: [] };
      entry.months.add(itemMonth);
      entry.days.push(Number(key.slice(8, 10)));
      entry.amounts.push(item.amountCents);
      map.set(groupKey, entry);
    });
    return map;
  }, [transactions, categories, effectiveThresholdCents, historyKeys]);

  const rows: BigExpenseRow[] = useMemo(() => {
    return monthExpenses
      .filter((item) => item.amountCents >= effectiveThresholdCents)
      .sort((left, right) => right.amountCents - left.amountCents)
      .map((item) => {
        const category = categories.find((entry) => entry.id === item.categoryId);
        const account = accounts.find((entry) => entry.id === item.accountId);
        const groupKey = item.merchant?.trim() || categoryPath(category, categories) || "未分类";
        const history = historyByGroup.get(groupKey);
        let badge: BigExpenseRow["badge"] = { kind: "none", text: "" };
        if (history && history.months.size >= 3) {
          const typicalDay = Math.round(median(history.days));
          const avg = Math.round(history.amounts.reduce((sum, value) => sum + value, 0) / history.amounts.length);
          badge = { kind: "recurring", text: `每月固定 · 近6月${history.months.size}次 · 多在${typicalDay}号前后 · 均值¥${centsToYuan(avg)}` };
        } else if (history && history.months.size === 1) {
          badge = { kind: "new", text: "近6个月首次出现" };
        }
        return {
          transaction: item,
          amountCents: item.amountCents,
          share: totalCents > 0 ? Math.round((item.amountCents / totalCents) * 100) : 0,
          categoryLabel: categoryPath(category, categories) || "未分类",
          accountLabel: account?.name ?? "",
          noteLabel: [item.merchant, item.note].filter(Boolean).join(" · "),
          badge
        };
      });
  }, [monthExpenses, effectiveThresholdCents, categories, accounts, historyByGroup, totalCents]);

  const bigSum = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const bigShare = totalCents > 0 ? Math.round((bigSum / totalCents) * 100) : 0;
  const [yearPart, monthPart] = month.split("-").map(Number);
  const lastYearKey = `${yearPart - 1}-${String(monthPart).padStart(2, "0")}`;
  const lastYearBigCents = sumCents(
    transactions.filter((item) => item.type === "expense" && item.amountCents >= effectiveThresholdCents && item.occurredAt.startsWith(lastYearKey))
  );
  const yoyDelta = lastYearBigCents > 0 ? percentDelta(bigSum, lastYearBigCents) : null;
  const recurringCount = rows.filter((row) => row.badge.kind === "recurring").length;

  function saveThreshold(value: string) {
    setThresholdInput(value);
    try {
      const cents = yuanToCents(value || "1000");
      if (cents > 0) localStorage.setItem(BIG_EXPENSE_THRESHOLD_KEY, value.trim() || "1000");
    } catch {
      // 输入不合法时只更新输入框，不保存
    }
  }

  return (
    <div className="big-expense-panel">
      <div className="big-expense-summary">
        <div>
          <span>大额笔数</span>
          <strong>{rows.length} 笔</strong>
        </div>
        <div>
          <span>大额合计</span>
          <strong>¥{centsToYuan(bigSum)}</strong>
        </div>
        <div>
          <span>占当月总支出</span>
          <strong>{bigShare}%</strong>
        </div>
        <div>
          <span>同比去年同月</span>
          <strong>{yoyDelta === null ? "无对照" : `${yoyDelta > 0 ? "+" : ""}${yoyDelta}%`}</strong>
        </div>
        <div>
          <span>每月固定大额</span>
          <strong>{recurringCount} 项</strong>
        </div>
      </div>
      <div className="big-expense-toolbar">
        <label>大额判定线（元）
          <input
            value={thresholdInput}
            inputMode="decimal"
            onChange={(event) => saveThreshold(event.target.value)}
          />
        </label>
        <span className="big-expense-threshold-hint">
          当前生效 ¥{centsToYuan(effectiveThresholdCents)}
          {autoApplied ? `（当月中位数×3 为 ¥${centsToYuan(autoThresholdCents)}，已自动取较高者）` : "（可在左侧调整）"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">{monthLabel(month)}没有超过 ¥{centsToYuan(effectiveThresholdCents)} 的支出。</p>
      ) : (
        <div className="big-expense-list">
          {rows.map((row) => (
            <div className="big-expense-row" key={row.transaction.id}>
              <span className="big-expense-date">{dateKey(row.transaction.occurredAt).slice(5)}</span>
              <div className="big-expense-main">
                <strong>{row.categoryLabel}</strong>
                <span>{[row.noteLabel, row.accountLabel].filter(Boolean).join(" · ") || "无备注"}</span>
                {row.badge.kind !== "none" && (
                  <em className={`big-badge ${row.badge.kind}`}>{row.badge.text}</em>
                )}
              </div>
              <div className="big-expense-amount">
                <strong>¥{centsToYuan(row.amountCents)}</strong>
                <div className="bar"><i style={{ width: `${Math.max(4, row.share)}%` } as CSSProperties} /></div>
                <em>占 {row.share}%</em>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.some((row) => row.badge.kind === "recurring") && (
        <p className="big-expense-insight">
          规律：标「每月固定」的支出近 6 个月出现 3 次以上且金额稳定，属于可预期的刚性开销，做预算时建议先扣掉这部分再分配日常额度。
        </p>
      )}
    </div>
  );
}
