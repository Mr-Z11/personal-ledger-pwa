import { describe, expect, it } from "vitest";
import { chinaDateKey, spendingAlertState, spendingDataStale } from "./spending-state.js";

/** 北京时间字符串直接带 +08:00，避免手工换算 Unix 时间戳 */
const bj = (value: string) => Date.parse(value);

describe("spendingDataStale — 消费类提醒的当天快照门槛", () => {
  it("复现 11/19：18:53 同步、22:01 表扬，3 小时前的快照不算当天可用数据", () => {
    expect(spendingDataStale(
      new Date(bj("2026-11-19T18:53:55+08:00")),
      bj("2026-11-19T22:01:51+08:00"),
      "2026-11-19"
    )).toBe(true);
  });

  it("复现 11/20：跨自然日、距上次写入约 24 小时，同样不发", () => {
    expect(spendingDataStale(
      new Date(bj("2026-11-19T18:53:55+08:00")),
      bj("2026-11-20T19:01:47+08:00"),
      "2026-11-20"
    )).toBe(true);
  });

  it("当天 2 小时内同步过才认为是可用快照", () => {
    expect(spendingDataStale(
      new Date(bj("2026-11-19T21:30:00+08:00")),
      bj("2026-11-19T22:01:51+08:00"),
      "2026-11-19"
    )).toBe(false);
  });

  it("恰好 2 小时仍算新鲜，超过 2 小时即陈旧", () => {
    const updated = new Date(bj("2026-11-19T20:00:00+08:00"));
    expect(spendingDataStale(updated, bj("2026-11-19T22:00:00+08:00"), "2026-11-19")).toBe(false);
    expect(spendingDataStale(updated, bj("2026-11-19T22:00:01+08:00"), "2026-11-19")).toBe(true);
  });

  it("跨北京时间零点时，昨晚刚写过的快照不能评价今天", () => {
    expect(spendingDataStale(
      new Date(bj("2026-11-19T23:30:00+08:00")),
      bj("2026-11-20T00:30:00+08:00")
    )).toBe(true);
  });

  it("chinaDateKey 按北京时间归属日期", () => {
    expect(chinaDateKey(new Date("2026-11-19T14:01:51.000Z"))).toBe("2026-11-19");
    expect(chinaDateKey(new Date("2026-11-19T16:01:51.000Z"))).toBe("2026-11-20");
  });
});

describe("spendingAlertState — 11/19 当时的真实判断", () => {
  const base = {
    monthDailyBudgetCents: 500000,
    spentThroughYesterdayCents: 334325,
    spentTodayCents: 3030,
    daysLeft: 12,
    toleranceCents: 2000
  };

  it("服务端只看到 ¥30.30 时会认为未超额，这正是错误表扬的来源", () => {
    const state = spendingAlertState(base);
    expect(state.dailyLimitCents).toBe(13806);
    expect(state.reached).toBe(false);
    expect(state.overLimit).toBe(false);
  });

  it("若当天实际支出已过线，同一套判据会拦住表扬", () => {
    const state = spendingAlertState({ ...base, spentTodayCents: 13806 });
    expect(state.reached).toBe(true);
    expect(state.overLimit).toBe(true);
  });
});
