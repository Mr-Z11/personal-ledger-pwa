/** 消费类提醒的纯判据：不依赖 config / prisma，便于单测与探针验证。 */

/** 北京时间日期键 YYYY-MM-DD，用于和前端的 dateKey 对齐 */
export function chinaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 当日消费状态：表扬与限额警告共用这一套判据，避免「已超额还提醒额度充足」。 */
export function spendingAlertState(input: {
  monthDailyBudgetCents: number;
  spentThroughYesterdayCents: number;
  spentTodayCents: number;
  daysLeft: number;
  toleranceCents: number;
}) {
  const { monthDailyBudgetCents, spentThroughYesterdayCents, spentTodayCents, toleranceCents } = input;
  const monthRemainingCents = monthDailyBudgetCents > 0
    ? Math.max(0, monthDailyBudgetCents - spentThroughYesterdayCents)
    : 0;
  const dailyLimitCents = Math.round(monthRemainingCents / Math.max(1, input.daysLeft));
  // 与前端 dailyLimitAlertTriggered 同口径：达线判据含误差金额
  const reached = spentTodayCents >= dailyLimitCents - toleranceCents;
  const monthOverBudget = monthDailyBudgetCents > 0
    && spentThroughYesterdayCents + spentTodayCents > monthDailyBudgetCents;
  // 未设预算 / 本月已超支时 dailyLimitCents 会是 0：此时既没法说「额度充足」，
  // 也不该在超额当天发正向表扬（旧实现的漏洞）。
  const overLimit = reached || monthOverBudget || dailyLimitCents <= 0;
  return { monthRemainingCents, dailyLimitCents, reached, monthOverBudget, overLimit };
}

/** 服务端凭账本快照判断「今天花了多少」时，快照必须足够新。
 *
 *  日级判断不能沿用 36 小时全局门：2026-11-19 18:53（北京时间）同步过一次，
 *  22:01 服务端据此发出「今天花得很稳」，但快照里只有 14:32 的一笔 ¥30.30，
 *  完全没有当晚新增的消费；手机本地已经超额，推送却说节制，自相矛盾。
 *
 *  这里要求快照同时满足：① 距检查时刻不超过 2 小时；② 落在同一个北京时间自然日。
 *  不满足就整条跳过消费类提醒，交给 App 打开时按本地 Dexie 数据触发的本机通知
 *  （「没开 App 又没同步则晚上不提醒」是用户已确认的设计代价）。
 */
export const SPENDING_SNAPSHOT_MAX_AGE_MS = 2 * 3600_000;

export function spendingDataStale(updatedAt: Date, nowMs: number = Date.now(), todayKey?: string) {
  if (nowMs - updatedAt.getTime() > SPENDING_SNAPSHOT_MAX_AGE_MS) return true;
  // 跨零点后，昨天刚写过的快照也不能拿来评价「今天」。
  return chinaDateKey(updatedAt) !== (todayKey ?? chinaDateKey(new Date(nowMs)));
}
