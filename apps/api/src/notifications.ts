import webpush from "web-push";
import { centsToYuan } from "@ledger/shared";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

export const DEFAULT_REMINDER_CONTENT = [
  "工资到账啦，按既定方案分配资金：",
  "1. 固定储蓄 50%",
  "2. 日常开销 30%",
  "3. 投资理财 20%",
  "记得先储蓄后消费！"
].join("\n");

export interface ReminderPayload {
  title: string;
  body: string;
  url?: string;
}

let pushReady = false;

export function initWebPush() {
  if (pushReady) return true;
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  pushReady = true;
  return true;
}

export function getVapidPublicKey() {
  return config.VAPID_PUBLIC_KEY ?? "";
}

async function deliver(userId: string, payload: ReminderPayload) {
  if (!initWebPush()) return false;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          { TTL: 24 * 60 * 60 }
        );
        delivered += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        // 记录失败原因，便于排查（如 VAPID subject 被 Apple 判为 BadJwtToken）
        console.error("[push] send failed", statusCode, (error as { body?: string }).body ?? (error as Error).message);
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        }
      }
    })
  );
  return delivered > 0;
}

export async function sendSalaryReminder(userId: string, content: string) {
  return deliver(userId, {
    title: "工资日资金分配提醒",
    body: content || DEFAULT_REMINDER_CONTENT,
    url: "/"
  });
}

export async function sendTestReminder(userId: string) {
  return deliver(userId, {
    title: "测试推送（通道验证）",
    body: "推送通道正常！当日限额警告、计划购买提醒都会像这样送到手机。",
    url: "/"
  });
}

export async function sendDailyLimitReminder(userId: string, spentCents: number, limitCents: number, toleranceCents = DAILY_LIMIT_TOLERANCE_CENTS) {
  const overCents = spentCents - limitCents;
  return deliver(userId, {
    title: overCents > 0 ? "⚠️ 今日消费已超出日限额" : "⚠️ 今日消费已到日限额",
    body: overCents > 0
      ? `今日已花 ¥${centsToYuan(spentCents)}，超出今日限额 ¥${centsToYuan(limitCents)} 共 ¥${centsToYuan(overCents)}。剩下的时间悠着点花！`
      : `今日已花 ¥${centsToYuan(spentCents)}，已达今日限额 ¥${centsToYuan(limitCents)} 附近（限额已含 ¥${centsToYuan(toleranceCents)} 误差线），还没超。`,
    url: "/"
  });
}

export async function sendPlanBuyReminder(userId: string, remainingCents: number, names: string[]) {
  const shown = names.slice(0, 3).join("、");
  const more = names.length > 3 ? ` 等 ${names.length} 项` : "";
  return deliver(userId, {
    title: "今日预算有余额，可以安排计划购买",
    body: `今日预算余额 ¥${centsToYuan(remainingCents)}，够买：${shown}${more}。打开总览标记完成。`,
    url: "/"
  });
}

/** 与前端 widgets.tsx praiseMessage 保持一致：低消费表扬文案 */
function praiseContent(period: "am" | "pm", kind: "zero" | "thrifty"): string {
  if (kind === "zero") {
    return period === "am"
      ? "上午一分钱没花，太赞了！守住钱包，应急资金越来越厚，压力也越来越小。"
      : "到下午都还没花钱，克制得漂亮！存款在悄悄变厚，心里更踏实、选择更多。";
  }
  return period === "am"
    ? "上午消费很节制，没有超支。保持这个节奏，月底更从容，应急资金也在增加。"
    : "下午依然花得很稳，没有过度消费。省钱的日子，选择更多、压力更小。";
}

export async function sendPraiseReminder(userId: string, period: "am" | "pm", kind: "zero" | "thrifty") {
  const title = kind === "zero" ? "🌱 表扬：今天很会守住钱" : "👏 表扬：今天消费很节制";
  return deliver(userId, {
    title,
    body: praiseContent(period, kind),
    url: "/"
  });
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function chinaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

async function checkAndSendReminders(log: FastifyBaseLogger) {
  try {
    const now = chinaNow();
    const monthKey = `${now.year}-${String(now.month).padStart(2, "0")}`;
    const settings = await prisma.reminderSetting.findMany({ where: { enabled: true } });
    for (const setting of settings) {
      const effectiveDay = Math.min(setting.salaryDay, daysInMonth(now.year, now.month - 1));
      if (effectiveDay !== now.day || now.hour < setting.remindHour) continue;
      const alreadySent = await prisma.reminderLog.findUnique({
        where: { userId_kind_month: { userId: setting.userId, kind: "salary", month: monthKey } }
      });
      if (alreadySent) continue;
      const delivered = await sendSalaryReminder(setting.userId, setting.content);
      await prisma.reminderLog.create({
        data: { userId: setting.userId, kind: "salary", month: monthKey }
      });
      log.info({ userId: setting.userId, delivered }, "salary reminder dispatched");
    }
    await checkSpendingAlerts(log);
  } catch (error) {
    log.error(error, "salary reminder check failed");
  }
}

/* ------------------------------------------------------------------ */
/* 当日限额警告 + 计划购买余额提醒（复用前端分类口径的关键词规则）            */
/* ------------------------------------------------------------------ */

/** 与前端 utils.ts isNonDailyExpenseCategory 保持一致 */
const NON_DAILY_PATTERN = /专项支出|非日常支出|未分类大额|贷款本金|本金还款|贷款利息|利息支出|保险|教育培训|课外培训|培训进修|教育|购车|养车|私家车保养/;
/** 误差线：当日消费达到「日限额 − ¥20」即视为达到限额（与前端默认容差一致） */
const DAILY_LIMIT_TOLERANCE_CENTS = 2000;

function chinaToday() {
  const now = chinaNow();
  const dayKey = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
  const monthKey = `${now.year}-${String(now.month).padStart(2, "0")}`;
  const start = new Date(Date.UTC(now.year, now.month - 1, now.day) - 8 * 3600_000);
  return { dayKey, monthKey, hour: now.hour, start, end: new Date(start.getTime() + 24 * 3600_000), days: daysInMonth(now.year, now.month - 1), year: now.year, month: now.month, day: now.day };
}

/** 北京时间日期键 YYYY-MM-DD，用于和前端的 dateKey 对齐 */
function chinaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function categoryPathOf(category: { name: string; parentId: string | null } | undefined, byId: Map<string, { name: string; parentId: string | null }>) {
  if (!category) return "";
  const parent = category.parentId ? byId.get(category.parentId) : undefined;
  if (parent) return `${parent.name} > ${category.name}`;
  return category.name === "其他" ? category.name : `其他 > ${category.name}`;
}

async function alreadySentToday(userId: string, kind: string, dayKey: string) {
  const existing = await prisma.reminderLog.findUnique({
    where: { userId_kind_month: { userId, kind, month: dayKey } }
  });
  return Boolean(existing);
}

async function markSentToday(userId: string, kind: string, dayKey: string) {
  await prisma.reminderLog.create({ data: { userId, kind, month: dayKey } });
}

async function checkSpendingAlerts(log: FastifyBaseLogger) {
  const today = chinaToday();
  const ledgers = await prisma.ledger.findMany({ select: { id: true, ownerId: true } });
  for (const ledger of ledgers) {
    try {
      const budgets = await prisma.budget.findMany({
        where: { ledgerId: ledger.id, month: today.monthKey, deletedAt: null }
      });
      const overallDaily = budgets.find((budget) => !budget.categoryId && budget.scope === "daily");
      const monthDailyBudgetCents = overallDaily
        ? Number(overallDaily.amountCents)
        : budgets.filter((budget) => budget.categoryId).reduce((sum, budget) => sum + Number(budget.amountCents), 0);

      // 与前端 widgets.tsx dailyLimitCents 保持一致：动态日限额
      // = (当月日常预算 − 截至昨日累计日常支出) ÷ 含今日在内的剩余天数
      const daysLeft = Math.max(1, today.days - today.day + 1);

      // 取本月 1 号至今的全部支出（含专项/非日常），再拆分「截至昨日」「今日日常」「今日全部」
      const monthStart = new Date(Date.UTC(today.year, today.month - 1, 1) - 8 * 3600_000);
      const [categories, monthExpenses] = await Promise.all([
        prisma.category.findMany({ where: { ledgerId: ledger.id }, select: { id: true, name: true, parentId: true } }),
        prisma.transaction.findMany({
          where: {
            ledgerId: ledger.id,
            type: "expense",
            deletedAt: null,
            occurredAt: { gte: monthStart, lt: today.end }
          },
          select: { amountCents: true, categoryId: true, occurredAt: true }
        })
      ]);
      const byId = new Map(categories.map((category) => [category.id, category]));
      const isDailyExpense = (item: { amountCents: bigint; categoryId: string | null; occurredAt: Date }) =>
        !NON_DAILY_PATTERN.test(categoryPathOf(item.categoryId ? byId.get(item.categoryId) : undefined, byId));

      const spentThroughYesterdayCents = monthExpenses
        .filter(isDailyExpense)
        .filter((item) => {
          const key = chinaDateKey(item.occurredAt);
          if (!key.startsWith(today.monthKey)) return false;
          return Number(key.slice(8, 10)) < today.day;
        })
        .reduce((sum, item) => sum + Number(item.amountCents), 0);

      const spentTodayCents = monthExpenses
        .filter(isDailyExpense)
        .filter((item) => chinaDateKey(item.occurredAt) === today.dayKey)
        .reduce((sum, item) => sum + Number(item.amountCents), 0);

      // 今日「全部」支出（含专项/非日常）—— 判断「真的 0 花费」用，避免把专项支出误判为一分钱没花
      const spentTodayTotalCents = monthExpenses
        .filter((item) => chinaDateKey(item.occurredAt) === today.dayKey)
        .reduce((sum, item) => sum + Number(item.amountCents), 0);

      const setting = await prisma.reminderSetting.findUnique({ where: { userId: ledger.ownerId } });

      // ---- 低消费表扬（不依赖预算即可发 zero 表扬；thrifty 需有日限额） ----
      // 开关对齐前端：主开关 dailyLimitEnabled（=设置页「当日限额提醒」）与子开关 praiseEnabled 同时开启才发
      const praiseOn = (setting?.dailyLimitEnabled ?? true) && (setting?.praiseEnabled ?? true);
      if (praiseOn) {
        const period = today.hour >= 18 ? "pm" : today.hour >= 12 ? "am" : null;
        if (period) {
          let praise: { period: "am" | "pm"; kind: "zero" | "thrifty" } | null = null;
          if (spentTodayTotalCents <= 0) {
            praise = { period, kind: "zero" };
          } else if (monthDailyBudgetCents > 0) {
            const dynamicLimitCents = Math.round(Math.max(0, monthDailyBudgetCents - spentThroughYesterdayCents) / daysLeft);
            if (spentTodayCents < dynamicLimitCents) praise = { period, kind: "thrifty" };
          }
          if (praise && !(await alreadySentToday(ledger.ownerId, "praise", `${today.dayKey}:${praise.period}`))) {
            const delivered = await sendPraiseReminder(ledger.ownerId, praise.period, praise.kind);
            if (delivered) await markSentToday(ledger.ownerId, "praise", `${today.dayKey}:${praise.period}`);
            log.info({ userId: ledger.ownerId, kind: praise.kind, delivered }, "praise reminder dispatched");
          }
        }
      }

      // ---- 预算相关分支（需设预算；无预算则跳过，但上面的表扬分支已先执行） ----
      if (monthDailyBudgetCents <= 0) continue;

      const monthRemainingCents = Math.max(0, monthDailyBudgetCents - spentThroughYesterdayCents);
      const dailyLimitCents = Math.round(monthRemainingCents / daysLeft);

      const dailyLimitEnabled = setting?.dailyLimitEnabled ?? true;
      const dailyLimitHour = setting?.dailyLimitHour ?? 21;
      const dailyLimitToleranceCents = setting?.dailyLimitToleranceCents ?? DAILY_LIMIT_TOLERANCE_CENTS;
      const reached = spentTodayCents >= dailyLimitCents - dailyLimitToleranceCents;

      if (reached) {
        // 未到设定的提醒时间不发推送（应用内全屏警告不受此限制）
        if (!dailyLimitEnabled || today.hour < dailyLimitHour) continue;
        if (!(await alreadySentToday(ledger.ownerId, "daily-limit", today.dayKey))) {
          const delivered = await sendDailyLimitReminder(ledger.ownerId, spentTodayCents, dailyLimitCents, dailyLimitToleranceCents);
          if (delivered) await markSentToday(ledger.ownerId, "daily-limit", today.dayKey);
          log.info({ userId: ledger.ownerId, spentTodayCents, dailyLimitCents, delivered }, "daily limit alert dispatched");
        }
        continue;
      }

      // 预算还有余额：看看计划购买清单里有没有今天买得起的东西
      const remainingCents = dailyLimitCents - spentTodayCents;
      const affordable = await prisma.plannedPurchase.findMany({
        where: { ledgerId: ledger.id, deletedAt: null, completedAt: null, amountCents: { lte: BigInt(remainingCents) } },
        orderBy: { amountCents: "asc" }
      });
      if (affordable.length === 0) continue;
      if (await alreadySentToday(ledger.ownerId, "planbuy", today.dayKey)) continue;
      const delivered = await sendPlanBuyReminder(ledger.ownerId, remainingCents, affordable.map((item) => item.name));
      if (delivered) await markSentToday(ledger.ownerId, "planbuy", today.dayKey);
      log.info({ userId: ledger.ownerId, remainingCents, count: affordable.length, delivered }, "plan-buy reminder dispatched");
    } catch (error) {
      log.error(error, `spending alert check failed for ledger ${ledger.id}`);
    }
  }
}

export function startReminderScheduler(log: FastifyBaseLogger) {
  if (config.NODE_ENV === "test") return;
  void checkAndSendReminders(log);
  const timer = setInterval(() => void checkAndSendReminders(log), 20 * 60 * 1000);
  timer.unref();
}
