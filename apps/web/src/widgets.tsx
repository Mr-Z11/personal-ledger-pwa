import { centsToYuan, monthKey, yuanToCents, type Account, type Budget, type Category, type PlannedPurchase, type Transaction } from "@ledger/shared";
import { BellRing, Check, Minus, Pencil, Plus, Search, ShoppingBag, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  beijingDateTimeParts,
  categoryPath,
  dailyExpenseTransactions,
  dateKey,
  daysInMonth,
  monthBudgetTotal,
  monthLabel,
  offsetMonthKey,
  percentDelta,
  previousMonthKeys,
  shortMonthLabel,
  yearLabel
} from "./utils";

/* ------------------------------------------------------------------ */
/* 说明/备注文字统一组件：一个「?」按钮，点击弹出解释气泡，保持界面清爽          */
/* ------------------------------------------------------------------ */

/** 点击「?」显示说明气泡；点外部或 Esc 关闭。用于把较长的说明/备注文字收起来。
 *  气泡用 portal 挂到 body 上并按视口定位：祖先容器（设置折叠区/面板/滚动区）常有
 *  overflow:hidden，气泡若留在「?」旁边会被整块裁掉（折叠区没展开时什么都看不到）。 */
export function InfoTip({ text, label = "查看说明" }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const canPortal = typeof document !== "undefined";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 按按钮在视口中的实际位置定位：下方放不下就翻到上方，左右都夹在视口内；
  // 滚动/旋转时跟着走，「?」滚出视口就关掉，避免留下孤立气泡
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = () => {
      const button = btnRef.current;
      const pop = popRef.current;
      if (!button || !pop) return;
      const rect = button.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const gap = 8;
      const edge = 8;
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const roomBelow = window.innerHeight - rect.bottom;
      const top = roomBelow >= height + gap || rect.top < height + gap
        ? Math.min(rect.bottom + gap, window.innerHeight - height - edge)
        : Math.max(edge, rect.top - height - gap);
      const left = Math.min(
        Math.max(edge, rect.left + rect.width / 2 - width / 2),
        Math.max(edge, window.innerWidth - width - edge)
      );
      setCoords({ top: Math.max(edge, top), left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const pop = (
    <div
      className="info-tip-pop"
      ref={popRef}
      role="tooltip"
      style={coords ? { top: coords.top, left: coords.left, visibility: "visible" as const } : { visibility: "hidden" as const }}
    >
      {text}
    </div>
  );

  return (
    <span className="info-tip">
      <button
        ref={btnRef}
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ?
      </button>
      {open && (canPortal ? createPortal(pop, document.body) : pop)}
    </span>
  );
}

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
        <InfoTip text="提醒完全保存在本机（离线、无服务器也能用）。打开应用时若到了工资日或倒计时范围内，首页顶部会显示横幅。当月没有 31 日时自动在当月最后一天提醒。" />
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 蓄水池预算可视化                                                    */
/* ------------------------------------------------------------------ */

const WAVE_PATH_A = "M -200 8 Q -175 -2 -150 8 T -100 8 T -50 8 T 0 8 T 50 8 T 100 8 T 150 8 T 200 8 L 200 260 L -200 260 Z";
const WAVE_PATH_B = "M -200 10 Q -180 0 -160 10 T -120 10 T -80 10 T -40 10 T 0 10 T 40 10 T 80 10 T 120 10 T 160 10 T 200 10 L 200 260 L -200 260 Z";

export function BudgetReservoir({ title, note, spentCents, budgetCents, accent, todayLimitCents, todaySpentCents }: {
  title: string;
  note?: string;
  spentCents: number;
  budgetCents: number;
  accent: string;
  /** 今日动态限额（日常消费预算专用）：传入后在页脚显示「今日限额 / 今日还可花」 */
  todayLimitCents?: number;
  todaySpentCents?: number;
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
            <div className="reservoir-readout">
              <strong>未设预算</strong>
              <span>本月已花 ¥{centsToYuan(spentCents)}</span>
              <em>设置 → 预算管理</em>
            </div>
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
          <div className="reservoir-readout">
            <strong>{Math.round(ratio * 100)}%</strong>
            <span>¥{centsToYuan(spentCents)} / ¥{centsToYuan(budgetCents)}</span>
            {over && <em className="reservoir-over-badge">超支 ¥{centsToYuan(spentCents - budgetCents)}</em>}
          </div>
        </div>
      </div>
      <footer className="reservoir-foot">
        {over ? (
          <span>已超支，剩余 {daysLeft} 天需控制消费才能回到线内</span>
        ) : todayLimitCents != null && todaySpentCents != null && todayLimitCents > 0 ? (
          <span>
            今日限额 ¥{centsToYuan(todayLimitCents)} ·{" "}
            {todaySpentCents > todayLimitCents
              ? `今日已超限额 ¥${centsToYuan(todaySpentCents - todayLimitCents)}`
              : `今日还可花 ¥${centsToYuan(todayLimitCents - todaySpentCents)}`}{" "}
            · 剩 {daysLeft} 天
          </span>
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
            <span>日均 ¥{centsToYuan(dailyAverage)}，<b>比预算快 ¥{centsToYuan(paceDelta)}</b>，照这个速度月底约 ¥{centsToYuan(projected)}</span>
          ) : (
            <span>日均 ¥{centsToYuan(dailyAverage)}，<b>比预算慢 ¥{centsToYuan(Math.abs(paceDelta))}</b>，花得比计划的省</span>
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
        {budgetCents > 0 && <span><i className="pace-swatch budget" />预算参考线</span>}
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
        <em><TrendIcon delta={budgetDelta ?? 0} />{budgetDelta === null ? "设置日常预算后自动对比" : `预算每天可花 ¥${centsToYuan(budgetDailyAvg)} · 实际每天花 ¥${centsToYuan(currentDailyAvg)}`}</em>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 大额开销分析（纯规则算法）                                            */
/* ------------------------------------------------------------------ */

const BIG_EXPENSE_THRESHOLD_KEY = "ledger-big-expense-threshold";
/** 后备保障金浮动金额：固定支出页手动维护，测算突发状况下的最低月支出 */
const FIXED_FLOAT_AMOUNT_KEY = "ledger-fixed-float-amount";

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

/* ------------------------------------------------------------------ */
/* 常规项支出：每月固定开销的逐月对比                                    */
/* ------------------------------------------------------------------ */

const REGULAR_WINDOW = 6;
const REGULAR_MIN_HITS = 3;
const REGULAR_MAX_ITEMS = 8;

type RegularExpenseGroup = {
  name: string;
  monthly: number[];
  monthsHit: number;
  avgCents: number;
  currentCents: number;
  prevCents: number;
  momDelta: number | null;
};

export function collectRegularExpenses(transactions: Transaction[], categories: Category[], endMonth: string, window = REGULAR_WINDOW, minHits = REGULAR_MIN_HITS) {
  const monthKeys = Array.from({ length: window }, (_, index) => offsetMonthKey(endMonth, -(window - 1 - index)));
  const groups = new Map<string, { name: string; monthly: number[]; monthsHit: number }>();
  transactions.forEach((item) => {
    if (item.type !== "expense") return;
    const key = dateKey(item.occurredAt).slice(0, 7);
    const index = monthKeys.indexOf(key);
    if (index < 0) return;
    const category = categories.find((entry) => entry.id === item.categoryId);
    const name = categoryPath(category, categories) || "未分类";
    const entry = groups.get(name) ?? { name, monthly: new Array<number>(window).fill(0), monthsHit: 0 };
    if (entry.monthly[index] === 0) entry.monthsHit += 1;
    entry.monthly[index] += item.amountCents;
    groups.set(name, entry);
  });
  const rows: RegularExpenseGroup[] = [...groups.values()]
    .filter((entry) => entry.monthsHit >= minHits)
    .map((entry) => {
      const total = entry.monthly.reduce((sum, value) => sum + value, 0);
      const currentCents = entry.monthly[window - 1];
      const prevCents = entry.monthly[window - 2] ?? 0;
      return {
        name: entry.name,
        monthly: entry.monthly,
        monthsHit: entry.monthsHit,
        avgCents: Math.round(total / window),
        currentCents,
        prevCents,
        momDelta: prevCents > 0 ? percentDelta(currentCents, prevCents) : null
      };
    })
    .sort((left, right) => right.avgCents - left.avgCents);
  return { monthKeys, rows };
}

function compactYuanText(cents: number) {
  const yuan = cents / 100;
  if (yuan <= 0) return "-";
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(1)}万`;
  if (yuan >= 1000) return `${(yuan / 1000).toFixed(1)}k`;
  return `${Math.round(yuan)}`;
}

export function RegularExpensePanel({ month, transactions, categories }: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
}) {
  const { monthKeys, rows } = useMemo(
    () => collectRegularExpenses(transactions, categories, month),
    [transactions, categories, month]
  );
  const shown = rows.slice(0, REGULAR_MAX_ITEMS);
  const hiddenCount = Math.max(0, rows.length - shown.length);

  const monthTotalCents = useMemo(
    () => transactions
      .filter((item) => item.type === "expense" && dateKey(item.occurredAt).startsWith(month))
      .reduce((sum, item) => sum + item.amountCents, 0),
    [transactions, month]
  );
  const currentRegularCents = shown.reduce((sum, row) => sum + row.currentCents, 0);
  const avgRegularCents = shown.reduce((sum, row) => sum + row.avgCents, 0);
  const share = monthTotalCents > 0 ? Math.round((currentRegularCents / monthTotalCents) * 100) : 0;

  if (rows.length === 0) {
    return <p className="empty">近 {REGULAR_WINDOW} 个月没有连续出现 {REGULAR_MIN_HITS} 次以上的支出分类，暂无常规项。</p>;
  }

  return (
    <div className="regular-expense-panel">
      <div className="regular-expense-summary">
        <div>
          <span>常规项</span>
          <strong>{rows.length} 项</strong>
        </div>
        <div>
          <span>常规项月均</span>
          <strong>¥{centsToYuan(avgRegularCents)}</strong>
        </div>
        <div>
          <span>{monthLabel(month)}常规项</span>
          <strong>¥{centsToYuan(currentRegularCents)}</strong>
        </div>
        <div>
          <span>占当月总支出</span>
          <strong>{monthTotalCents > 0 ? `${share}%` : "无支出"}</strong>
        </div>
      </div>
      <div className="regular-expense-table" role="table" aria-label="常规支出项逐月对比">
        <div className="regular-expense-row regular-expense-head" role="row">
          <span className="regular-expense-name">常规项（近{REGULAR_WINDOW}个月出现≥{REGULAR_MIN_HITS}次）</span>
          {monthKeys.map((key) => (
            <span key={key} className={`regular-expense-cell head ${key === month ? "current" : ""}`}>{shortMonthLabel(key)}</span>
          ))}
        </div>
        {shown.map((row) => {
          const maxValue = Math.max(...row.monthly, 1);
          return (
            <div className="regular-expense-row" role="row" key={row.name}>
              <span className="regular-expense-name">
                <strong>{row.name}</strong>
                <em>
                  月均 ¥{centsToYuan(row.avgCents)}
                  {row.momDelta !== null ? ` · 环比 ${row.momDelta > 0 ? "+" : ""}${row.momDelta}%` : ""}
                </em>
              </span>
              {row.monthly.map((value, index) => (
                <span
                  key={monthKeys[index]}
                  className={`regular-expense-cell ${monthKeys[index] === month ? "current" : ""}`}
                  title={`${monthLabel(monthKeys[index])} ¥${centsToYuan(value)}`}
                >
                  <i style={{ height: `${Math.max(value > 0 ? 8 : 2, Math.round((value / maxValue) * 100))}%` }} />
                  <b>{compactYuanText(value)}</b>
                </span>
              ))}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && <p className="regular-expense-more">另有 {hiddenCount} 个金额较小的常规项未列出，按 6 个月均值排序取前 {REGULAR_MAX_ITEMS} 项。</p>}
      <p className="big-expense-insight">
        口径：同一支出分类近 {REGULAR_WINDOW} 个月出现 {REGULAR_MIN_HITS} 次及以上即判定为常规项（含日常消费与贷款、保险等固定专项），月均按 {REGULAR_WINDOW} 个月平均；这些是可预期的刚性开销，做下月规划时可先锁定。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 保险缴费日历存储（本机 localStorage，不进仓库、不同步）                 */
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
export function scheduledInsuranceCents(items: InsuranceItem[], monthKeyValue: string) {
  const month = Number(monthKeyValue.slice(5, 7));
  return items.filter((item) => item.month === month).reduce((sum, item) => sum + item.amountCents, 0);
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

/* ------------------------------------------------------------------ */
/* 总览：当月固定支出（手动维护，可复制为后续月份模板）                    */
/* ------------------------------------------------------------------ */

export type FixedExpenseItem = {
  id: string;
  name: string;
  /** 预计（分） */
  predictedCents: number;
  /** 已支出（分）：未关联分类时手动填写；关联分类后由当月该分类消费自动汇总 */
  spentCents: number;
  /** 关联的分类 id；非空时「已支出」自动跟踪当月该分类的实际消费 */
  categoryId?: string | null;
};

export type FixedExpenseCandidate = {
  name: string;
  predictedCents: number;
  source: "常规项" | "保险日历";
  categoryId: string | null;
};

const FIXED_EXPENSES_PREFIX = "ledger-fixed-expenses-";

export function loadFixedExpenses(monthKeyValue: string): FixedExpenseItem[] {
  try {
    const raw = localStorage.getItem(FIXED_EXPENSES_PREFIX + monthKeyValue);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<FixedExpenseItem>[];
    return parsed
      .filter((item) => item && typeof item.name === "string")
      .map((item, index) => ({
        id: typeof item.id === "string" ? item.id : `fx-${monthKeyValue}-${index}`,
        name: item.name as string,
        predictedCents: Math.max(0, Math.round(Number(item.predictedCents) || 0)),
        spentCents: Math.max(0, Math.round(Number(item.spentCents) || 0)),
        categoryId: typeof item.categoryId === "string" ? item.categoryId : null
      }));
  } catch {
    return [];
  }
}

export function saveFixedExpenses(monthKeyValue: string, items: FixedExpenseItem[]) {
  localStorage.setItem(FIXED_EXPENSES_PREFIX + monthKeyValue, JSON.stringify(items));
}

/** 把 sourceMonth 的项目作为模板复制到其后 count 个月：已支出归零，预计与分类关联保留；已有数据的月份不覆盖。返回实际复制的月份数。 */
export function copyFixedExpensesToFuture(sourceMonth: string, count: number): number {
  const items = loadFixedExpenses(sourceMonth);
  if (items.length === 0) return 0;
  let copied = 0;
  for (let offset = 1; offset <= count; offset += 1) {
    const target = offsetMonthKey(sourceMonth, offset);
    if (loadFixedExpenses(target).length > 0) continue;
    const cloned: FixedExpenseItem[] = items.map((item) => ({
      id: `fx-${target}-${Math.random().toString(36).slice(2, 9)}`,
      name: item.name,
      predictedCents: item.predictedCents,
      spentCents: 0,
      categoryId: item.categoryId ?? null
    }));
    saveFixedExpenses(target, cloned);
    copied += 1;
  }
  return copied;
}

function resolveCategoryId(path: string, categories: Category[]): string | null {
  if (!path || path === "未分类") return null;
  return categories.find((category) => categoryPath(category, categories) === path)?.id ?? null;
}

/** 参考项：沿用原「根据规划」的口径——近数月常规支出 + 保险缴费日历，作为手动添加时的推荐。 */
export function buildFixedExpenseSuggestions(transactions: Transaction[], categories: Category[], currentKey: string): FixedExpenseCandidate[] {
  const schedule = loadInsuranceSchedule();
  const configured = schedule.length > 0;
  const candidates: FixedExpenseCandidate[] = [];

  const historyEndKey = offsetMonthKey(currentKey, -1);
  const { rows } = collectRegularExpenses(transactions, categories, historyEndKey);
  rows.forEach((row) => {
    if (configured && /保险/.test(row.name)) return;
    candidates.push({
      name: row.name,
      predictedCents: row.avgCents,
      source: "常规项",
      categoryId: resolveCategoryId(row.name, categories)
    });
  });

  const insuranceCents = configured ? scheduledInsuranceCents(schedule, currentKey) : 0;
  if (insuranceCents > 0) {
    candidates.push({
      name: "保险（缴费日历）",
      predictedCents: insuranceCents,
      source: "保险日历",
      categoryId: categories.find((category) => /保险/.test(categoryPath(category, categories)))?.id ?? null
    });
  }
  return candidates;
}

function FixedExpenseRow({ item, autoSpent, categories, onChange, onDelete, onUnlink }: {
  item: FixedExpenseItem;
  /** 非 null 表示该固定项已关联分类，已支出由当月该分类消费自动汇总（只读） */
  autoSpent: number | null;
  categories: Category[];
  onChange: (patch: Partial<FixedExpenseItem>) => void;
  onDelete: () => void;
  onUnlink: () => void;
}) {
  // 默认只读紧凑行，点行进入编辑；保存才写回，避免每敲一个字就落库
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [spent, setSpent] = useState(() => centsToYuan(item.spentCents));
  const [predicted, setPredicted] = useState(() => centsToYuan(item.predictedCents));
  const [categoryId, setCategoryId] = useState(item.categoryId ?? "");

  const tracked = autoSpent !== null;
  const effectiveSpent = tracked ? autoSpent : item.spentCents;
  const remaining = Math.max(0, item.predictedCents - effectiveSpent);
  const pct = item.predictedCents > 0 ? Math.min(100, Math.round((effectiveSpent / item.predictedCents) * 100)) : 0;
  const over = item.predictedCents > 0 && effectiveSpent > item.predictedCents;

  function startEdit() {
    setName(item.name);
    setSpent(centsToYuan(item.spentCents));
    setPredicted(centsToYuan(item.predictedCents));
    setCategoryId(item.categoryId ?? "");
    setEditing(true);
  }

  function commit() {
    let nextSpent = item.spentCents;
    let nextPredicted = item.predictedCents;
    try { nextSpent = yuanToCents(spent.trim() || "0"); } catch { /* 保留原值 */ }
    try { nextPredicted = yuanToCents(predicted.trim() || "0"); } catch { /* 保留原值 */ }
    onChange({
      name: name.trim() || item.name,
      predictedCents: nextPredicted,
      categoryId: categoryId || null,
      spentCents: categoryId ? 0 : nextSpent
    });
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className={tracked ? "fixed-expense-row compact tracked" : "fixed-expense-row compact"}>
        <button type="button" className="fe-row-main" onClick={startEdit} title="点击修改这项固定支出">
          <span className="fe-item-name">
            {item.name}
            {tracked && <em className="fe-auto-tag">自动</em>}
            <Pencil size={11} className="fe-edit-hint" />
          </span>
          <span className="fe-item-money">
            <em>支出</em>¥{centsToYuan(effectiveSpent)}
            <i>/</i>
            <em>预计</em>¥{centsToYuan(item.predictedCents)}
          </span>
        </button>
        <div className="fe-right">
          <span className={`fe-remaining ${over ? "over" : ""}`}>
            {over ? `超 ¥${centsToYuan(effectiveSpent - item.predictedCents)}` : `剩 ¥${centsToYuan(remaining)}`}
          </span>
          <div className="fe-bar"><i style={{ width: `${effectiveSpent > 0 ? Math.max(3, pct) : 0}%` }} /></div>
        </div>
        <button type="button" className="icon-button" title="删除这项" aria-label="删除这项" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed-expense-row manual editing">
      <input
        className="fe-name"
        value={name}
        maxLength={20}
        placeholder="项目名"
        onChange={(event) => setName(event.target.value)}
      />
      <div className="fe-fields">
        {tracked ? (
          <label className="fe-field fe-auto">
            <span>已支出 <em className="fe-auto-tag">自动</em></span>
            <span className="fe-amount fe-auto-value">¥{centsToYuan(effectiveSpent)}</span>
            <button
              type="button"
              className="link-button fe-unlink"
              onClick={() => {
                // 解除关联后转为手动：把当前自动累计值填进输入框，避免保存时又关联回去
                setCategoryId("");
                setSpent(centsToYuan(effectiveSpent));
                onUnlink();
              }}
            >改手动</button>
          </label>
        ) : (
          <label className="fe-field">
            <span>已支出</span>
            <input
              className="fe-amount"
              inputMode="decimal"
              value={spent}
              onChange={(event) => setSpent(event.target.value)}
            />
          </label>
        )}
        <label className="fe-field">
          <span>预计</span>
          <input
            className="fe-amount"
            inputMode="decimal"
            value={predicted}
            onChange={(event) => setPredicted(event.target.value)}
          />
        </label>
        <label className="fe-field fe-field-cat">
          <span>关联分类</span>
          <select
            className="fe-cat"
            value={categoryId}
            title="关联分类后，已支出按当月该分类消费自动累计"
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">不关联（手动填）</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{categoryPath(category, categories)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="fe-edit-actions">
        <button type="button" className="primary fe-save" onClick={commit}>保存</button>
        <button type="button" className="ghost fe-cancel" onClick={() => setEditing(false)}>取消</button>
      </div>
    </div>
  );
}

export function FixedExpenseOverview({ transactions = [], categories = [] }: {
  transactions?: Transaction[];
  categories?: Category[];
}) {
  const currentKey = monthKey();
  const [items, setItems] = useState<FixedExpenseItem[]>(() => loadFixedExpenses(currentKey));
  const [nameInput, setNameInput] = useState("");
  const [predictedInput, setPredictedInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [copyMonths, setCopyMonths] = useState(1);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  /** 后备保障金的浮动金额：用户手动编辑，仅存本机（同类设置见大额阈值） */
  const [floatInput, setFloatInput] = useState(() => localStorage.getItem(FIXED_FLOAT_AMOUNT_KEY) ?? "");

  useEffect(() => {
    setItems(loadFixedExpenses(currentKey));
  }, [currentKey]);

  const suggestions = useMemo(() => {
    const list = buildFixedExpenseSuggestions(transactions, categories, currentKey);
    const names = new Set(items.map((item) => item.name.trim()));
    return list.filter((candidate) => !names.has(candidate.name.trim()));
  }, [transactions, categories, currentKey, items]);

  const autoSpentByItem = useMemo(() => {
    const map = new Map<string, number | null>();
    items.forEach((item) => {
      if (!item.categoryId) {
        map.set(item.id, null);
        return;
      }
      const sum = transactions
        .filter((tx) => tx.type === "expense" && dateKey(tx.occurredAt).startsWith(currentKey) && tx.categoryId === item.categoryId)
        .reduce((sum, tx) => sum + tx.amountCents, 0);
      map.set(item.id, sum);
    });
    return map;
  }, [items, transactions, currentKey]);

  function persist(next: FixedExpenseItem[]) {
    setItems(next);
    saveFixedExpenses(currentKey, next);
  }

  function addItem(name: string, predictedCents: number, categoryId: string | null = null) {
    if (!name.trim() || predictedCents <= 0) return;
    persist([
      ...items,
      { id: `fx-${currentKey}-${Math.random().toString(36).slice(2, 9)}`, name: name.trim(), predictedCents, spentCents: 0, categoryId }
    ]);
    setNameInput("");
    setPredictedInput("");
    setCategoryInput("");
  }

  function updateItem(id: string, patch: Partial<FixedExpenseItem>) {
    persist(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function deleteItem(id: string) {
    persist(items.filter((item) => item.id !== id));
  }

  function unlinkItem(id: string, currentAuto: number) {
    updateItem(id, { categoryId: null, spentCents: Math.max(0, currentAuto) });
  }

  function copyTemplate() {
    copyFixedExpensesToFuture(currentKey, copyMonths);
    setCopiedMsg(true);
    window.setTimeout(() => setCopiedMsg(false), 2600);
  }

  const effectiveSpent = (item: FixedExpenseItem) => autoSpentByItem.get(item.id) ?? item.spentCents;
  const totalPredicted = items.reduce((sum, item) => sum + item.predictedCents, 0);
  const totalSpent = items.reduce((sum, item) => sum + effectiveSpent(item), 0);
  const totalRemaining = Math.max(0, totalPredicted - totalSpent);
  const donePct = totalPredicted > 0 ? Math.min(100, Math.round((totalSpent / totalPredicted) * 100)) : 0;

  /* 后备保障金：突发状况下砍掉大额与弹性消费后，每月至少要备好的钱
     = 本月全部固定项（生活 + 贷款等刚性支出）+ 用户手动补充的浮动金额 */
  const floatCents = (() => {
    try { return Math.max(0, yuanToCents(floatInput.trim() || "0")); } catch { return 0; }
  })();
  const reserveCents = totalPredicted + floatCents;

  function saveFloatInput(value: string) {
    setFloatInput(value);
    try { localStorage.setItem(FIXED_FLOAT_AMOUNT_KEY, value.trim()); } catch { /* 存储不可用时仅内存生效 */ }
  }

  return (
    <section className="panel fixed-expense-overview">
      <div className="chart-heading">
        <h2>本月固定支出<InfoTip text="手动维护，不依赖交易记录；从参考项目添加且关联了分类时，已支出会随当月该分类的实际消费自动更新（显示「自动」）。导入 AI 后可由消费记录全自动生成，此处改为只读对照。" /></h2>
        <div className="fe-head-right">
          <span>{monthLabel(currentKey)} · {items.length} 项 · 手动维护</span>
          <button
            type="button"
            className={showAdd ? "fe-add-icon active" : "fe-add-icon"}
            title={showAdd ? "收起新增" : "新增固定支出项"}
            aria-label={showAdd ? "收起新增" : "新增固定支出项"}
            onClick={() => setShowAdd((value) => !value)}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="fixed-expense-add">
          <input
            className="fe-name"
            value={nameInput}
            placeholder="新项目（如：房租）"
            maxLength={20}
            autoFocus
            onChange={(event) => setNameInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                let predicted = 0;
                try { predicted = yuanToCents(predictedInput || "0"); } catch { return; }
                addItem(nameInput, predicted, categoryInput || null);
              }
            }}
          />
          <input
            className="fe-amount fe-add-amount"
            inputMode="decimal"
            value={predictedInput}
            placeholder="预计 ¥"
            onChange={(event) => setPredictedInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                let predicted = 0;
                try { predicted = yuanToCents(predictedInput || "0"); } catch { return; }
                addItem(nameInput, predicted, categoryInput || null);
              }
            }}
          />
          <select
            className="fe-cat fe-add-cat"
            value={categoryInput}
            title="选择分类后，已支出按当月该分类消费自动累计"
            onChange={(event) => setCategoryInput(event.target.value)}
          >
            <option value="">关联分类（可选）</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{categoryPath(category, categories)}</option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            disabled={!nameInput.trim() || !predictedInput.trim()}
            onClick={() => {
              let predicted = 0;
              try { predicted = yuanToCents(predictedInput || "0"); } catch { return; }
              addItem(nameInput, predicted, categoryInput || null);
            }}
          >
            <Plus size={16} />添加
          </button>
        </div>
      )}
      <div className="fixed-expense-total">
        <div>
          <span>固定项合计</span>
          <strong>¥{centsToYuan(totalPredicted)}</strong>
        </div>
        <div>
          <span>已支出合计</span>
          <strong>¥{centsToYuan(totalSpent)}</strong>
        </div>
        <div>
          <span>待支出额度</span>
          <strong>¥{centsToYuan(totalRemaining)}</strong>
        </div>
        <div className="fixed-expense-total-progress">
          <div className="bar"><i style={{ width: `${Math.max(2, donePct)}%` }} /></div>
          <em>已支出 {donePct}%</em>
        </div>
      </div>

      <div className="fixed-expense-reserve">
        <div className="fixed-expense-reserve-head">
          <span>
            后备保障金（浮动金额）
            <InfoTip text="突发状况下的最低月度准备：本月全部固定支出（房租、水电、贷款等刚性支出）+ 你手动补充的浮动金额（餐饮、交通等日常开销）。突发时砍掉大额消费与弹性开支后，这就是每月至少要备好的钱。浮动金额可随时修改，只保存在本机。" />
          </span>
          <label className="fixed-expense-reserve-input">
            <em>¥</em>
            <input
              inputMode="decimal"
              value={floatInput}
              placeholder="补充浮动开支"
              maxLength={12}
              onChange={(event) => saveFloatInput(event.target.value)}
              onBlur={() => {
                try {
                  const cents = yuanToCents(floatInput.trim() || "0");
                  saveFloatInput(cents > 0 ? centsToYuan(cents) : "");
                } catch { /* 输入不合法时保留原样，不打断编辑 */ }
              }}
            />
          </label>
        </div>
        <div className="fixed-expense-reserve-total">
          <span>后备最低月支出</span>
          <strong>{`¥${centsToYuan(reserveCents)}`}</strong>
        </div>
        <small className="fixed-expense-reserve-hint">
          固定项合计 ¥{centsToYuan(totalPredicted)}（{items.length} 项）+ 浮动 ¥{centsToYuan(floatCents)} · 砍掉大额与弹性消费后，每月至少备这么多
        </small>
      </div>

      {suggestions.length > 0 && (
        <div className="fixed-expense-suggest">
          <button type="button" className="suggest-toggle" onClick={() => setShowSuggest((value) => !value)}>
            {showSuggest ? "收起" : "展开"}参考项目（来自规划/历史，点选即可添加）
          </button>
          {showSuggest && (
            <ul className="suggest-list">
              {suggestions.map((candidate) => (
                <li key={candidate.name} className="suggest-item">
                  <span className="suggest-name">{candidate.name}</span>
                  <span className="suggest-meta">预计 ¥{centsToYuan(candidate.predictedCents)} · {candidate.source}{candidate.categoryId ? " · 自动跟踪" : ""}</span>
                  <button type="button" className="suggest-add" onClick={() => addItem(candidate.name, candidate.predictedCents, candidate.categoryId)}>
                    <Plus size={13} />添加
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="fixed-expense-colhead">
          <span>项目 · 支出 / 预计（点行可改）</span>
          <span>剩余进度</span>
        </div>
      )}

      <div className="fixed-expense-list">
        {items.length === 0 ? (
          <p className="empty">还没有固定支出项。点标题右侧的「＋」手动新建，或展开上方参考项目点选添加；已支出可手动填，也可关联分类后自动跟踪当月消费。</p>
        ) : (
          items.map((item) => {
            const auto = autoSpentByItem.get(item.id) ?? null;
            return (
              <FixedExpenseRow
                key={item.id}
                item={item}
                autoSpent={auto}
                categories={categories}
                onChange={(patch) => updateItem(item.id, patch)}
                onDelete={() => deleteItem(item.id)}
                onUnlink={() => unlinkItem(item.id, auto ?? 0)}
              />
            );
          })
        )}
      </div>

      <div className="fixed-expense-template">
        <span>把当前 {items.length} 项作为模板复制到下月：</span>
        <select value={copyMonths} onChange={(event) => setCopyMonths(Number(event.target.value))}>
          {Array.from({ length: 11 }, (_, index) => index + 1).map((months) => (
            <option key={months} value={months}>{months} 个月</option>
          ))}
        </select>
        <button type="button" className="ghost" disabled={items.length === 0} onClick={copyTemplate}>
          复制模板
        </button>
        {copiedMsg && <em className="copied-hint">已复制到后续月份（已有数据的月份不会被覆盖）</em>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 当日限额提醒：达到日限额（含误差线）时全屏红色警告 + 本地通知            */
/* ------------------------------------------------------------------ */

export type DailyLimitAlertSettings = {
  enabled: boolean;
  /** 误差金额（分）：当日消费达到「日限额 − 误差」即触发提醒 */
  toleranceCents: number;
  notify: boolean;
  /** 低消费表扬：晚上 19 点后没过度消费就发一条鼓励推送（白天不发，服务端主动推送不依赖打开 App） */
  praiseEnabled: boolean;
};

const DAILY_LIMIT_ALERT_KEY = "ledger-daily-limit-alert";
const DAILY_LIMIT_DISMISS_KEY = "ledger-daily-limit-dismissed";
const DAILY_LIMIT_NOTIFY_KEY = "ledger-daily-limit-notified";
const PRAISE_NOTIFY_KEY = "ledger-no-spend-praise-notified";

export const DEFAULT_DAILY_LIMIT_ALERT: DailyLimitAlertSettings = {
  enabled: true,
  toleranceCents: 2000,
  notify: true,
  praiseEnabled: true
};

export function loadDailyLimitAlertSettings(): DailyLimitAlertSettings {
  try {
    const raw = localStorage.getItem(DAILY_LIMIT_ALERT_KEY);
    if (!raw) return DEFAULT_DAILY_LIMIT_ALERT;
    const parsed = JSON.parse(raw) as Partial<DailyLimitAlertSettings>;
    return {
      enabled: parsed.enabled !== false,
      toleranceCents: Math.max(0, Math.round(Number(parsed.toleranceCents) || DEFAULT_DAILY_LIMIT_ALERT.toleranceCents)),
      notify: parsed.notify !== false,
      praiseEnabled: parsed.praiseEnabled !== false
    };
  } catch {
    return DEFAULT_DAILY_LIMIT_ALERT;
  }
}

export function saveDailyLimitAlertSettings(settings: DailyLimitAlertSettings) {
  localStorage.setItem(DAILY_LIMIT_ALERT_KEY, JSON.stringify(settings));
}

/** 今日动态日限额：当月日常预算减去「截至昨日」的累计支出，再除以「含今日在内的剩余天数」。
 * 当日消费不影响当日限额（只影响次日及以后），多花/少花自动滚动到后面天数。未设预算返回 0。 */
export function dailyLimitCents(budgets: Budget[], transactions: Transaction[], categories: Category[], month: string): number {
  const monthBudget = monthBudgetTotal(budgets, month);
  if (monthBudget <= 0) return 0;
  const today = Number(beijingDateTimeParts().day);
  const totalDays = daysInMonth(month);
  const daysLeft = Math.max(1, totalDays - today + 1);
  const spentThroughYesterday = dailyExpenseTransactions(transactions, categories)
    .filter((item) => {
      const key = dateKey(item.occurredAt);
      if (!key.startsWith(month)) return false;
      return Number(key.slice(8, 10)) < today;
    })
    .reduce((sum, item) => sum + item.amountCents, 0);
  const remaining = Math.max(0, monthBudget - spentThroughYesterday);
  return Math.round(remaining / daysLeft);
}

/** 今日日常消费合计（不含贷款/保险/教育等专项） */
export function todayDailySpentCents(transactions: Transaction[], categories: Category[]) {
  const today = dateKey(new Date().toISOString());
  return dailyExpenseTransactions(transactions, categories)
    .filter((item) => dateKey(item.occurredAt) === today)
    .reduce((sum, item) => sum + item.amountCents, 0);
}

/** 今日全部支出合计（含贷款/保险/教育/专项等所有分类）—— 用于判断「真的 0 花费」。
 * 任何分类花过钱都算花过，避免「上午花了一笔保险/贷款却收到『一分钱没花』表扬」的错判。 */
export function todayAllSpentCents(transactions: Transaction[], categories: Category[]) {
  const today = dateKey(new Date().toISOString());
  return transactions
    .filter((item) => item.type === "expense")
    .filter((item) => dateKey(item.occurredAt) === today)
    .reduce((sum, item) => sum + item.amountCents, 0);
}

/** 是否触发当日限额提醒：今日消费 ≥ 日限额 − 误差金额 */
export function dailyLimitAlertTriggered(settings: DailyLimitAlertSettings, spentTodayCents: number, limitCents: number) {
  return settings.enabled && limitCents > 0 && spentTodayCents >= limitCents - settings.toleranceCents;
}

export function dismissDailyLimitAlertForToday() {
  localStorage.setItem(DAILY_LIMIT_DISMISS_KEY, dateKey(new Date().toISOString()));
}

export function dailyLimitAlertDismissedKey() {
  return localStorage.getItem(DAILY_LIMIT_DISMISS_KEY);
}

const PUSH_SUBSCRIBED_KEY = "ledger-push-subscribed";

/** 是否已在手机 PWA 订阅服务端 web push。订阅后，表扬/限额提醒由服务端后台推送送达，
 * 前端不再叠发本地通知，避免「App 打开时同一条提醒弹两次」。 */
export function isPushSubscribed(): boolean {
  try {
    return localStorage.getItem(PUSH_SUBSCRIBED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPushSubscribed(value: boolean) {
  try {
    if (value) localStorage.setItem(PUSH_SUBSCRIBED_KEY, "1");
    else localStorage.removeItem(PUSH_SUBSCRIBED_KEY);
  } catch {
    // 隐私模式下写入可能失败，忽略
  }
}

/** 触发后每天发一条系统通知（失败静默降级为应用内全屏警告） */
export function maybeNotifyDailyLimit(settings: DailyLimitAlertSettings, spentTodayCents: number, limitCents: number) {
  if (!settings.enabled || !settings.notify) return;
  if (isPushSubscribed()) return; // 已订阅后台推送，避免与 web-push 重复弹窗
  if (!dailyLimitAlertTriggered(settings, spentTodayCents, limitCents)) return;
  const todayKey = dateKey(new Date().toISOString());
  if (localStorage.getItem(DAILY_LIMIT_NOTIFY_KEY) === todayKey) return;
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const overCents = spentTodayCents - limitCents;
    new Notification(overCents > 0 ? "⚠️ 今日消费已超出日限额" : "⚠️ 今日消费已到日限额", {
      body: overCents > 0
        ? `今日已花 ¥${centsToYuan(spentTodayCents)}，超出今日限额 ¥${centsToYuan(limitCents)} 共 ¥${centsToYuan(overCents)}。`
        : `今日已花 ¥${centsToYuan(spentTodayCents)}，已达今日限额 ¥${centsToYuan(limitCents)} 附近（限额已含 ¥${centsToYuan(settings.toleranceCents)} 误差线），还没超。`
    });
    localStorage.setItem(DAILY_LIMIT_NOTIFY_KEY, todayKey);
  } catch {
    // 部分平台不支持本地 Notification，忽略
  }
}

/** 低消费表扬是否到期：只在晚上（19 点）起评。
 * 用户要求晚上 19 点主动发一条（服务端 web push，不依赖打开 App）——每天最多一条。
 * 条件：
 * - zero：今天全部支出（含专项）=0，即真的「一分钱没花」；
 * - thrifty：设有日限额且今日日常消费低于限额（没超支）。
 * totalSpentTodayCents 为今日全部支出，缺省回退到日常支出以兼容旧调用。 */
export function noSpendPraiseDue(hour: number, spentTodayCents: number, limitCents: number, totalSpentTodayCents: number = spentTodayCents): { period: "am" | "pm"; kind: "zero" | "thrifty" } | null {
  const period = hour >= 19 ? "pm" : null;
  if (!period) return null;
  if (totalSpentTodayCents <= 0) return { period, kind: "zero" };
  if (limitCents > 0 && spentTodayCents < limitCents) return { period, kind: "thrifty" };
  return null;
}

/** 表扬文案：正向鼓励，强调应急资金变厚、压力变小。只剩晚上一个时段（19 点起）。 */
export function praiseMessage(kind: "zero" | "thrifty"): string {
  return kind === "zero"
    ? "到今天都还没花钱，克制得漂亮！存款在悄悄变厚，心里更踏实、选择更多。"
    : "今天花得很稳，没有过度消费。省钱的日子，选择更多、压力更小。";
}

/** 低消费表扬：晚上（19 点后）没怎么花就发一条鼓励推送（每天最多一条）。
 * 白天一律不发——用户要求晚上 19 点主动发一条、不依赖打开 App。 */
export function maybePraiseNoSpend(settings: DailyLimitAlertSettings, spentTodayCents: number, limitCents: number, totalSpentTodayCents?: number) {
  if (!settings.enabled || !settings.notify || settings.praiseEnabled === false) return;
  if (isPushSubscribed()) return; // 已订阅后台推送，避免与 web-push 重复弹窗
  const due = noSpendPraiseDue(Number(beijingDateTimeParts().hour), spentTodayCents, limitCents, totalSpentTodayCents ?? spentTodayCents);
  if (!due) return;
  const stamp = `${dateKey(new Date().toISOString())}:${due.period}`;
  if (localStorage.getItem(PRAISE_NOTIFY_KEY) === stamp) return;
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(due.kind === "zero" ? "🌱 表扬：今天很会守住钱" : "👏 表扬：今天消费很节制", {
      body: praiseMessage(due.kind)
    });
    localStorage.setItem(PRAISE_NOTIFY_KEY, stamp);
  } catch {
    // 不支持本地通知时忽略
  }
}

/** 常驻的当日限额警示条：达线=琥珀、超支=深红。全屏遮罩关掉后它仍在，
 * 配合 body 上的 daily-limit-over 皮肤，让整个界面持续保持警示状态。 */
export function DailyLimitRibbon({ spentCents, limitCents }: {
  spentCents: number;
  limitCents: number;
}) {
  const overCents = spentCents - limitCents;
  const over = overCents > 0;
  const percent = limitCents > 0 ? Math.max(0, Math.round((spentCents / limitCents) * 100)) : 0;
  return (
    <div className={`daily-limit-ribbon ${over ? "over" : "warn"}`} role="status">
      <span className="daily-limit-ribbon-mark">!</span>
      <div className="daily-limit-ribbon-body">
        <strong>{over ? `今日已超日限额 ¥${centsToYuan(overCents)}` : "今日已到日限额"}</strong>
        <small>已花 ¥{centsToYuan(spentCents)} / 限额 ¥{centsToYuan(limitCents)} · 今天别再花了</small>
      </div>
      <span className="daily-limit-ribbon-pct">{percent}%</span>
    </div>
  );
}

/** 全屏红色警告遮罩：达到限额时覆盖整个页面，关闭后仅本次会话不再弹出（下次打开仍会提醒） */
export function DailyLimitOverlay({ spentCents, limitCents, toleranceCents, onDismiss }: {
  spentCents: number;
  limitCents: number;
  toleranceCents: number;
  onDismiss: () => void;
}) {
  const overCents = spentCents - limitCents;
  const reachedOnly = overCents <= 0;
  useEffect(() => {
    document.body.classList.add("daily-limit-lock");
    return () => document.body.classList.remove("daily-limit-lock");
  }, []);
  return (
    <div className="daily-limit-overlay" role="alert" aria-live="assertive">
      <div className="daily-limit-card">
        <span className="daily-limit-icon">⚠️</span>
        <h2>{reachedOnly ? "今日消费已到日限额" : "今日消费已超出日限额"}</h2>
        <div className="daily-limit-figure">
          <span className="daily-limit-label">今日已花（实际消费）</span>
          <p className="daily-limit-amount">¥{centsToYuan(spentCents)}</p>
        </div>
        <div className="daily-limit-meta">
          <div>
            <span>今日限额</span>
            <strong>¥{centsToYuan(limitCents)}</strong>
          </div>
          <div>
            <span>{reachedOnly ? "状态" : "超出限额"}</span>
            <strong className={reachedOnly ? "" : "over"}>
              {reachedOnly ? "误差线内，还没超" : `¥${centsToYuan(overCents)}`}
            </strong>
          </div>
        </div>
        <p className="daily-limit-detail">
          今日限额已含 ¥{centsToYuan(toleranceCents)} 误差线，花到 ¥{centsToYuan(Math.max(0, limitCents - toleranceCents))} 就算达线。
        </p>
        <p className="daily-limit-advice">今天花的每一笔都会滚入明天的动态限额——少花明天更宽裕，多花后面几天自动收紧。想买的东西先加进「计划购买」，等额度够时再买。</p>
        <button type="button" className="daily-limit-dismiss" onClick={onDismiss}>知道了（下次打开仍会提醒）</button>
      </div>
    </div>
  );
}

export function LocalDailyLimitAlertPanel({ value, onChange }: {
  value: DailyLimitAlertSettings;
  onChange: (settings: DailyLimitAlertSettings) => void;
}) {
  const [draft, setDraft] = useState<DailyLimitAlertSettings>(value);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const [toleranceInput, setToleranceInput] = useState(() => centsToYuan(value.toleranceCents));
  const changed = JSON.stringify(draft) !== JSON.stringify(value) || toleranceInput !== centsToYuan(value.toleranceCents);

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

  /** 误差金额改动即时生效（含服务端推送），开关走「保存设置」 */
  function save() {
    let toleranceCents = value.toleranceCents;
    try {
      const parsed = yuanToCents(toleranceInput || "20");
      if (parsed >= 0) toleranceCents = parsed;
    } catch {
      // 输入不合法时沿用原值
    }
    const next = { ...draft, toleranceCents };
    onChange(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="reminder-panel form-stack">
      <div className={`reminder-status ${value.enabled ? "on" : ""}`}>
        <BellRing size={16} />
        <span>{value.enabled ? `已开启：今日消费达日限额 − ¥${centsToYuan(value.toleranceCents)} 即全屏警告并推送手机提醒` : "未开启"}</span>
      </div>
      <label>误差金额（元）<InfoTip text="今日动态限额 =（月日常预算 − 截至昨日累计支出）÷ 含今日的剩余天数。今日消费 ≥ 今日动态限额 − 误差金额 时：打开应用立即全屏红色警告，同时推送手机提醒（每天一条）。当日花多少只影响明天及以后的限额，不改变今天自己的限额。" />
        <input
          value={toleranceInput}
          inputMode="decimal"
          onChange={(event) => setToleranceInput(event.target.value)}
        />
      </label>
      <label className="reminder-toggle">
        <input type="checkbox" checked={draft.notify} onChange={(event) => void toggleNotify(event.target.checked)} />
        同时发送系统通知（每天一条；服务端推送开启后，关闭应用也能收到）<InfoTip text="达到限额后打开应用会全屏红色警告，点「知道了」后当天不再弹出；手机推送由服务器每 20 分钟检查一次，达线即推（每天最多一条）。" />
      </label>
      <label className="reminder-toggle">
        <input type="checkbox" checked={draft.praiseEnabled} onChange={(event) => setDraft((current) => ({ ...current, praiseEnabled: event.target.checked }))} />
        低消费表扬：晚上 19 点后没超支，就由服务端主动推送一条鼓励（不依赖打开 App，应急资金越来越多、压力更小）
      </label>
      <div className="data-actions">
        {draft.enabled ? (
          <button type="button" onClick={() => { const next = { ...draft, enabled: false }; setDraft(next); onChange(next); }}>关闭提醒</button>
        ) : (
          <button className="primary" type="button" onClick={() => { const next = { ...draft, enabled: true }; setDraft(next); onChange(next); }}>
            <BellRing size={16} />开启提醒
          </button>
        )}
        <button type="button" disabled={!changed} onClick={save}>{saved ? "已保存" : "保存设置"}</button>
      </div>
      {permission === "denied" && <p className="reminder-hint warn">系统通知权限已被拒绝：可在系统设置中允许通知；即使不开通知，应用内全屏警告依然有效。</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 计划购买（想买清单）：预算余额够买时提醒，买完点已完成                     */
/* ------------------------------------------------------------------ */

const PLAN_BUY_NOTIFY_KEY = "ledger-planbuy-notified";

function planBuyNotifiedToday(): { date: string; ids: string[] } {
  try {
    const raw = localStorage.getItem(PLAN_BUY_NOTIFY_KEY);
    if (!raw) return { date: "", ids: [] };
    const parsed = JSON.parse(raw) as { date?: string; ids?: string[] };
    return { date: typeof parsed.date === "string" ? parsed.date : "", ids: Array.isArray(parsed.ids) ? parsed.ids : [] };
  } catch {
    return { date: "", ids: [] };
  }
}

/** 今日预算余额够买某项时发一条本地系统通知（每天每项最多一条） */
function maybeNotifyPlanBuy(affordable: PlannedPurchase[], remainingCents: number) {
  if (affordable.length === 0) return;
  const todayKey = dateKey(new Date().toISOString());
  const record = planBuyNotifiedToday();
  const notifiedIds = record.date === todayKey ? record.ids : [];
  const fresh = affordable.filter((item) => !notifiedIds.includes(item.id));
  if (fresh.length === 0) return;
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const names = fresh.slice(0, 3).map((item) => item.name).join("、");
    const more = fresh.length > 3 ? ` 等 ${fresh.length} 项` : "";
    new Notification("今日预算有余额，可以安排计划购买", {
      body: `今日预算余额 ¥${centsToYuan(remainingCents)}，够买：${names}${more}。`
    });
    localStorage.setItem(PLAN_BUY_NOTIFY_KEY, JSON.stringify({ date: todayKey, ids: [...notifiedIds, ...fresh.map((item) => item.id)] }));
  } catch {
    // 不支持本地通知时忽略（服务端推送会兜底）
  }
}

export function PlannedPurchasePanel({ items, todayRemainingCents, onAdd, onToggleComplete, onDelete, onEdit }: {
  items: PlannedPurchase[];
  /** 今日预算余额（分）；null 表示未设日常预算，无法判断 */
  todayRemainingCents: number | null;
  onAdd: (name: string, amountCents: number) => void;
  onToggleComplete: (item: PlannedPurchase) => void;
  onDelete: (item: PlannedPurchase) => void;
  onEdit: (item: PlannedPurchase, name: string, amountCents: number) => void;
}) {
  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const [showAdd, setShowAdd] = useState(false);
  // 行内编辑：默认只读，点行进入编辑；保存才写回，避免每敲一个字就落库
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");

  const pending = useMemo(
    () => items.filter((item) => !item.completedAt).sort((left, right) => left.amountCents - right.amountCents),
    [items]
  );
  const completed = useMemo(
    () => items.filter((item) => item.completedAt).sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt))),
    [items]
  );
  const pendingTotal = pending.reduce((sum, item) => sum + item.amountCents, 0);
  const affordable = todayRemainingCents === null ? [] : pending.filter((item) => item.amountCents <= todayRemainingCents);

  useEffect(() => {
    maybeNotifyPlanBuy(affordable, todayRemainingCents ?? 0);
  }, [affordable, todayRemainingCents]);

  function addItem() {
    const name = nameInput.trim();
    if (!name) return;
    let amountCents = 0;
    try {
      amountCents = yuanToCents(amountInput || "0");
    } catch {
      return;
    }
    if (amountCents <= 0) return;
    onAdd(name, amountCents);
    setNameInput("");
    setAmountInput("");
    setShowAdd(false);
  }

  function startEdit(item: PlannedPurchase) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditAmount(centsToYuan(item.amountCents));
  }

  function cancelEdit() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setEditingId(null);
    setEditName("");
    setEditAmount("");
  }

  function saveEdit(item: PlannedPurchase) {
    const name = editName.trim();
    if (!name) return;
    let amountCents = item.amountCents;
    try {
      amountCents = yuanToCents(editAmount || "0");
    } catch {
      return;
    }
    if (amountCents <= 0) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onEdit(item, name, amountCents);
    setEditingId(null);
    setEditName("");
    setEditAmount("");
  }

  async function requestNotifyPermission() {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  }

  return (
    <section className="panel planbuy-panel">
      <div className="chart-heading">
        <h2>计划购买<InfoTip text="清单云端同步，多设备一致；余额够买时应用内高亮 + 手机推送提醒（每天一轮）。点条目可编辑名称/预算；「买到手」移入已买列表；右侧垃圾桶才是删除。" /></h2>
        <span>
          {pending.length > 0
            ? `${pending.length} 项待买 · 合计 ¥${centsToYuan(pendingTotal)}`
            : "把想买的东西和预算记在这里，当天有额度时会提醒你"}
          {todayRemainingCents !== null && pending.length > 0
            ? todayRemainingCents >= 0
              ? ` · 今日还可花 ¥${centsToYuan(todayRemainingCents)}`
              : ` · 今日已超限额 ¥${centsToYuan(-todayRemainingCents)}`
            : ""}
        </span>
      </div>

      <div className="planbuy-toolbar">
        <button
          type="button"
          className={showAdd ? "planbuy-add-toggle active" : "planbuy-add-toggle"}
          onClick={() => setShowAdd((value) => !value)}
        >
          <Plus size={15} />{showAdd ? "收起新增" : "新增计划购买"}
        </button>
      </div>

      {showAdd && (
        <div className="planbuy-add">
          <input
            value={nameInput}
            placeholder="想买什么（如：冬季床上三件套）"
            maxLength={40}
            onChange={(event) => setNameInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addItem(); }}
          />
          <input
            value={amountInput}
            placeholder="预算 ¥"
            inputMode="decimal"
            className="planbuy-amount"
            onChange={(event) => setAmountInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addItem(); }}
          />
          <button type="button" className="primary" disabled={!nameInput.trim() || !amountInput.trim()} onClick={addItem}>
            <ShoppingBag size={16} />加入清单
          </button>
        </div>
      )}

      {todayRemainingCents === null && pending.length > 0 && (
        <p className="reminder-hint">未设日常消费预算，无法判断今日余额（设置 → 预算管理）。</p>
      )}
      {permission === "default" && pending.length > 0 && (
        <p className="reminder-hint">
          想在余额够买时收到手机提醒？
          <button type="button" className="link-button" onClick={() => void requestNotifyPermission()}>点这里开启通知</button>
        </p>
      )}

      {pending.length === 0 && completed.length === 0 ? (
        <p className="empty">清单是空的。想买但当天超预算的东西记在这里，有额度时优先安排，不再靠脑子记。</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="planbuy-list">
              {pending.map((item) => {
                const canBuy = todayRemainingCents !== null && item.amountCents <= todayRemainingCents;
                const gap = todayRemainingCents !== null ? item.amountCents - todayRemainingCents : 0;
                if (editingId === item.id) {
                  return (
                    <div className="planbuy-row editing" key={item.id}>
                      <div className="planbuy-main">
                        <input
                          className="planbuy-edit-name"
                          value={editName}
                          placeholder="想买什么"
                          maxLength={40}
                          autoFocus
                          onChange={(event) => setEditName(event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter") saveEdit(item); if (event.key === "Escape") cancelEdit(); }}
                        />
                      </div>
                      <div className="planbuy-side">
                        <input
                          className="planbuy-edit-amount"
                          value={editAmount}
                          placeholder="预算 ¥"
                          inputMode="decimal"
                          onChange={(event) => setEditAmount(event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter") saveEdit(item); if (event.key === "Escape") cancelEdit(); }}
                        />
                        <div className="planbuy-actions">
                          <button type="button" className="planbuy-mark" disabled={!editName.trim() || !editAmount.trim()} onClick={() => saveEdit(item)}>保存</button>
                          <button type="button" className="link-button" onClick={cancelEdit}>取消</button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className={`planbuy-row ${canBuy ? "affordable" : ""}`} key={item.id}>
                    <button type="button" className="planbuy-main planbuy-edit-trigger" title="点击编辑名称或预算" onClick={() => startEdit(item)}>
                      <strong>{item.name}</strong>
                      <span className={`planbuy-status ${canBuy ? "ok" : ""}`}>
                        {todayRemainingCents === null
                          ? "未设预算"
                          : canBuy
                            ? "今日可买"
                            : `还差 ¥${centsToYuan(gap)}`}
                      </span>
                      <Pencil size={11} className="fe-edit-hint" />
                    </button>
                    <div className="planbuy-side">
                      <strong>¥{centsToYuan(item.amountCents)}</strong>
                      <div className="planbuy-actions">
                        <button type="button" className="planbuy-mark" title="标记已买到手，移入已买列表" onClick={() => onToggleComplete(item)}>
                          买到手
                        </button>
                        <button type="button" className="icon-button" title="删除这条计划" aria-label="删除这条计划" onClick={() => onDelete(item)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {completed.length > 0 && (
            <details className="planbuy-completed">
              <summary>已买 {completed.length} 项（点开查看/撤销）</summary>
              <div className="planbuy-list">
                {completed.map((item) => {
                  if (editingId === item.id) {
                    return (
                      <div className="planbuy-row done editing" key={item.id}>
                        <div className="planbuy-main">
                          <input
                            className="planbuy-edit-name"
                            value={editName}
                            placeholder="想买什么"
                            maxLength={40}
                            autoFocus
                            onChange={(event) => setEditName(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") saveEdit(item); if (event.key === "Escape") cancelEdit(); }}
                          />
                        </div>
                        <div className="planbuy-side">
                          <input
                            className="planbuy-edit-amount"
                            value={editAmount}
                            placeholder="预算 ¥"
                            inputMode="decimal"
                            onChange={(event) => setEditAmount(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") saveEdit(item); if (event.key === "Escape") cancelEdit(); }}
                          />
                          <div className="planbuy-actions">
                            <button type="button" className="planbuy-mark" disabled={!editName.trim() || !editAmount.trim()} onClick={() => saveEdit(item)}>保存</button>
                            <button type="button" className="link-button" onClick={cancelEdit}>取消</button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="planbuy-row done" key={item.id}>
                      <button type="button" className="planbuy-main planbuy-edit-trigger" title="点击编辑名称或预算" onClick={() => startEdit(item)}>
                        <strong>{item.name}</strong>
                        <span className="planbuy-status done-badge">
                          <Check size={12} />已买{item.completedAt ? ` · ${dateKey(item.completedAt).slice(5)}` : ""}
                        </span>
                        <Pencil size={11} className="fe-edit-hint" />
                      </button>
                      <div className="planbuy-side">
                        <strong>¥{centsToYuan(item.amountCents)}</strong>
                        <div className="planbuy-actions">
                          <button type="button" className="link-button" title="买错了？移回待买列表" onClick={() => onToggleComplete(item)}>撤销</button>
                          <button type="button" className="icon-button" title="删除这条计划" aria-label="删除这条计划" onClick={() => onDelete(item)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 搜索历史记录（关键词 + 按月/年汇总）                                  */
/* ------------------------------------------------------------------ */

/** 关键词匹配消费记录（排除收入/已删除），匹配备注、商户、标签、账户名、分类名。 */
export function searchMatches(needle: string, transactions: Transaction[], accounts: Account[], categories: Category[]): Transaction[] {
  const q = needle.trim().toLowerCase();
  if (!q) return [];
  return transactions
    .filter((item) => item.type !== "income" && !item.deletedAt)
    .filter((item) => {
      const category = categories.find((entry) => entry.id === item.categoryId);
      const haystack = [
        item.note ?? "",
        item.merchant ?? "",
        (item.tags ?? []).join(" "),
        accounts.find((entry) => entry.id === item.accountId)?.name ?? "",
        category?.name ?? "",
        categoryPath(category, categories)
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/** 按时间段汇总支出：sliceLen=7 按月、4 按年。 */
export function aggregateByPeriod(matches: Transaction[], sliceLen: number): { key: string; count: number; cents: number }[] {
  const groups = new Map<string, { count: number; cents: number }>();
  matches.forEach((item) => {
    const key = item.occurredAt.slice(0, sliceLen);
    const group = groups.get(key) ?? { count: 0, cents: 0 };
    group.count += 1;
    if (item.type === "expense") group.cents += item.amountCents;
    groups.set(key, group);
  });
  return Array.from(groups.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.key.localeCompare(left.key));
}

export function SearchView({ transactions, accounts, categories }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
}) {
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(200);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [sortMode, setSortMode] = useState<"date-desc" | "date-asc" | "amount-desc" | "amount-asc">("date-desc");
  const needle = query.trim();

  const matched = useMemo(() => searchMatches(needle, transactions, accounts, categories), [transactions, accounts, categories, needle]);

  // 搜索词变化时重置筛选与排序
  useEffect(() => {
    setCategoryFilter("");
    setAccountFilter("");
    setFromMonth("");
    setToMonth("");
    setSortMode("date-desc");
    setVisibleLimit(200);
  }, [needle]);

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    matched.forEach((item) => {
      if (item.categoryId && !seen.has(item.categoryId)) {
        seen.set(item.categoryId, categoryPath(categories.find((entry) => entry.id === item.categoryId), categories) || "未分类");
      }
    });
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [matched, categories]);

  const accountOptions = useMemo(() => {
    const seen = new Map<string, string>();
    matched.forEach((item) => {
      if (item.accountId && !seen.has(item.accountId)) {
        seen.set(item.accountId, accounts.find((entry) => entry.id === item.accountId)?.name ?? "账户");
      }
    });
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [matched, accounts]);

  const monthOptions = useMemo(() => Array.from(new Set(matched.map((item) => item.occurredAt.slice(0, 7)))).sort(), [matched]);

  const filtered = useMemo(() => {
    let list = matched;
    if (categoryFilter) list = list.filter((item) => item.categoryId === categoryFilter);
    if (accountFilter) list = list.filter((item) => item.accountId === accountFilter);
    if (fromMonth) list = list.filter((item) => item.occurredAt.slice(0, 7) >= fromMonth);
    if (toMonth) list = list.filter((item) => item.occurredAt.slice(0, 7) <= toMonth);
    return [...list].sort((left, right) => {
      if (sortMode === "date-asc") return left.occurredAt.localeCompare(right.occurredAt);
      if (sortMode === "amount-desc") return right.amountCents - left.amountCents;
      if (sortMode === "amount-asc") return left.amountCents - right.amountCents;
      return right.occurredAt.localeCompare(left.occurredAt);
    });
  }, [matched, categoryFilter, accountFilter, fromMonth, toMonth, sortMode]);

  const monthly = useMemo(() => aggregateByPeriod(filtered, 7), [filtered]);
  const yearly = useMemo(() => aggregateByPeriod(filtered, 4), [filtered]);

  const expenseTotal = filtered.reduce((sum, item) => sum + (item.type === "expense" ? item.amountCents : 0), 0);
  const count = filtered.length;
  const hasFilters = Boolean(categoryFilter || accountFilter || fromMonth || toMonth);
  const monthlyAvg = monthly.length > 0 ? Math.round(expenseTotal / monthly.length) : 0;
  const dateRange = count > 0
    ? `${filtered.reduce((min, item) => (item.occurredAt < min ? item.occurredAt : min), filtered[0].occurredAt).slice(0, 10)} ~ ${filtered.reduce((max, item) => (item.occurredAt > max ? item.occurredAt : max), filtered[0].occurredAt).slice(0, 10)}`
    : "";

  const maxMonthly = monthly.reduce((max, item) => Math.max(max, item.cents), 0);
  const maxYearly = yearly.reduce((max, item) => Math.max(max, item.cents), 0);
  const visible = filtered.slice(0, visibleLimit);

  return (
    <section className="panel search-view">
      <div className="chart-heading">
        <h2>搜索记录</h2>
        <span>{needle ? `匹配 ${matched.length} 笔${hasFilters ? ` · 筛选后 ${count} 笔` : ""}` : "输入关键词，查看明细与按月/年汇总"}</span>
      </div>

      <label className="search search-big">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索消费记录，如：加油、餐饮、物业费…"
          autoFocus
        />
        {query && (
          <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="清除">
            <X size={16} />
          </button>
        )}
      </label>

      {needle && matched.length > 0 && (
        <div className="search-filters">
          <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setVisibleLimit(200); }} disabled={categoryOptions.length === 0}>
            <option value="">全部分类</option>
            {categoryOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          <select value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value); setVisibleLimit(200); }} disabled={accountOptions.length === 0}>
            <option value="">全部账户</option>
            {accountOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          <select value={fromMonth} onChange={(event) => { setFromMonth(event.target.value); setVisibleLimit(200); }} disabled={monthOptions.length === 0} title="起始月份">
            <option value="">起始月</option>
            {monthOptions.map((month) => <option key={`from-${month}`} value={month}>{monthLabel(month)}</option>)}
          </select>
          <select value={toMonth} onChange={(event) => { setToMonth(event.target.value); setVisibleLimit(200); }} disabled={monthOptions.length === 0} title="截止月份">
            <option value="">截止月</option>
            {monthOptions.map((month) => <option key={`to-${month}`} value={month}>{monthLabel(month)}</option>)}
          </select>
          <select value={sortMode} onChange={(event) => { setSortMode(event.target.value as typeof sortMode); setVisibleLimit(200); }}>
            <option value="date-desc">日期 ↓</option>
            <option value="date-asc">日期 ↑</option>
            <option value="amount-desc">金额 ↓</option>
            <option value="amount-asc">金额 ↑</option>
          </select>
          {hasFilters && (
            <button type="button" className="search-clear-filters" onClick={() => { setCategoryFilter(""); setAccountFilter(""); setFromMonth(""); setToMonth(""); setVisibleLimit(200); }}>清除筛选</button>
          )}
        </div>
      )}

      {!needle ? (
        <p className="empty">输入关键词（备注、商户、分类或标签均可），即可列出匹配的消费明细，并按月、按年汇总其总体状况。</p>
      ) : matched.length === 0 ? (
        <p className="empty">没有找到包含「{query}」的消费记录。</p>
      ) : count === 0 ? (
        <p className="empty">没有符合当前筛选条件的记录。<button type="button" className="link-button" onClick={() => { setCategoryFilter(""); setAccountFilter(""); setFromMonth(""); setToMonth(""); }}>清除筛选</button></p>
      ) : (
        <>
          <div className="search-summary">
            <div><span>笔数</span><strong>{count}</strong></div>
            <div><span>支出合计</span><strong className="expense">¥{centsToYuan(expenseTotal)}</strong></div>
            <div><span>月均</span><strong>¥{centsToYuan(monthlyAvg)}</strong></div>
            <div className="search-summary-range"><span>区间</span><em>{dateRange}</em></div>
          </div>

          {monthly.length > 0 && (
            <div className="search-breakdown">
              <h3>按月汇总</h3>
              <ul>
                {monthly.map((item) => (
                  <li key={item.key}>
                    <span className="bd-label">{monthLabel(item.key)}</span>
                    <span className="bd-bar"><i style={{ width: `${maxMonthly > 0 ? Math.round((item.cents / maxMonthly) * 100) : 0}%` }} /></span>
                    <span className="bd-count">{item.count}笔</span>
                    <strong className="bd-amount">¥{centsToYuan(item.cents)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {yearly.length > 0 && (
            <div className="search-breakdown">
              <h3>按年汇总</h3>
              <ul>
                {yearly.map((item) => (
                  <li key={item.key}>
                    <span className="bd-label">{yearLabel(item.key)}</span>
                    <span className="bd-bar"><i style={{ width: `${maxYearly > 0 ? Math.round((item.cents / maxYearly) * 100) : 0}%` }} /></span>
                    <span className="bd-count">{item.count}笔</span>
                    <strong className="bd-amount">¥{centsToYuan(item.cents)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="search-detail">
            <h3>明细（{count} 笔）</h3>
            <ul className="search-detail-list">
              {visible.map((item) => {
                const category = categories.find((entry) => entry.id === item.categoryId);
                return (
                  <li key={item.id}>
                    <span className="sd-date">{item.occurredAt.slice(0, 10)}</span>
                    <span className="sd-cat">{categoryPath(category, categories) || (item.type === "transfer" ? "转账" : "未分类")}</span>
                    <span className="sd-note">{item.merchant || item.note || ""}</span>
                    <strong className={`sd-amount ${item.type === "income" ? "income" : item.type === "expense" ? "expense" : "transfer"}`}>
                      {item.type === "income" ? "+" : item.type === "expense" ? "-" : ""}¥{centsToYuan(item.amountCents)}
                    </strong>
                  </li>
                );
              })}
            </ul>
            {matched.length > visibleLimit && (
              <button type="button" className="ghost" onClick={() => setVisibleLimit((value) => value + 200)}>
                加载更多（还有 {matched.length - visibleLimit} 笔）
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
