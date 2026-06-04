import { describe, expect, it } from "vitest";
import { centsToYuan, monthKey, yuanToCents } from "./index";

describe("money helpers", () => {
  it("converts yuan to integer cents", () => {
    expect(yuanToCents("12.30")).toBe(1230);
    expect(yuanToCents("12")).toBe(1200);
    expect(yuanToCents("-0.50")).toBe(-50);
  });

  it("formats cents as yuan", () => {
    expect(centsToYuan(1230)).toBe("12.30");
    expect(centsToYuan(-50)).toBe("-0.50");
  });

  it("builds stable month keys", () => {
    expect(monthKey(new Date("2026-06-04T12:00:00Z"))).toBe("2026-06");
  });
});
