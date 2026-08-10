import { describe, expect, it } from "vitest";
import {
  inAWeekPreset,
  thisWeekendPreset,
  toDatetimeLocalValue,
  tonightPreset,
} from "../date-presets";

// A Wednesday, 10:00am local.
const WEDNESDAY_MORNING = new Date(2026, 7, 12, 10, 0, 0, 0);
// A Saturday, 3:00pm local (past the noon preset target).
const SATURDAY_AFTERNOON = new Date(2026, 7, 15, 15, 0, 0, 0);
// A Wednesday, 10:00pm local (past the 9pm "tonight" target).
const WEDNESDAY_NIGHT = new Date(2026, 7, 12, 22, 0, 0, 0);

describe("tonightPreset", () => {
  it("returns 9pm today when it's still before 9pm", () => {
    const result = tonightPreset(WEDNESDAY_MORNING);
    expect(result.getDate()).toBe(WEDNESDAY_MORNING.getDate());
    expect(result.getHours()).toBe(21);
    expect(result.getMinutes()).toBe(0);
  });

  it("rolls to tomorrow 9pm when it's already past 9pm tonight", () => {
    const result = tonightPreset(WEDNESDAY_NIGHT);
    expect(result.getDate()).toBe(WEDNESDAY_NIGHT.getDate() + 1);
    expect(result.getHours()).toBe(21);
  });

  it("is always strictly in the future", () => {
    expect(tonightPreset(WEDNESDAY_MORNING).getTime()).toBeGreaterThan(
      WEDNESDAY_MORNING.getTime(),
    );
    expect(tonightPreset(WEDNESDAY_NIGHT).getTime()).toBeGreaterThan(WEDNESDAY_NIGHT.getTime());
  });
});

describe("thisWeekendPreset", () => {
  it("lands on a Saturday at noon", () => {
    const result = thisWeekendPreset(WEDNESDAY_MORNING);
    expect(result.getDay()).toBe(6);
    expect(result.getHours()).toBe(12);
  });

  it("is strictly in the future from a mid-week 'now'", () => {
    expect(thisWeekendPreset(WEDNESDAY_MORNING).getTime()).toBeGreaterThan(
      WEDNESDAY_MORNING.getTime(),
    );
  });

  it("rolls to next Saturday when it's already Saturday afternoon", () => {
    const result = thisWeekendPreset(SATURDAY_AFTERNOON);
    expect(result.getDay()).toBe(6);
    expect(result.getDate()).toBe(SATURDAY_AFTERNOON.getDate() + 7);
    expect(result.getTime()).toBeGreaterThan(SATURDAY_AFTERNOON.getTime());
  });
});

describe("inAWeekPreset", () => {
  it("is exactly 7 days later, same time of day", () => {
    const result = inAWeekPreset(WEDNESDAY_MORNING);
    expect(result.getTime() - WEDNESDAY_MORNING.getTime()).toBe(7 * 86_400_000);
    expect(result.getHours()).toBe(WEDNESDAY_MORNING.getHours());
  });
});

describe("toDatetimeLocalValue", () => {
  it("formats as YYYY-MM-DDTHH:mm with zero-padding", () => {
    const date = new Date(2026, 0, 5, 9, 3, 0, 0);
    expect(toDatetimeLocalValue(date)).toBe("2026-01-05T09:03");
  });

  it("round-trips through new Date() to the same local instant", () => {
    const original = tonightPreset(WEDNESDAY_MORNING);
    const roundTripped = new Date(toDatetimeLocalValue(original));
    expect(roundTripped.getTime()).toBe(original.getTime());
  });
});
