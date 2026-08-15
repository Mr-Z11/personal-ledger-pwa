import webpush from "web-push";
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
    title: "测试提醒",
    body: "恭喜！工资日提醒已开启，到时会像这样提醒你分配资金。",
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
  } catch (error) {
    log.error(error, "salary reminder check failed");
  }
}

export function startReminderScheduler(log: FastifyBaseLogger) {
  if (config.NODE_ENV === "test") return;
  void checkAndSendReminders(log);
  const timer = setInterval(() => void checkAndSendReminders(log), 20 * 60 * 1000);
  timer.unref();
}
