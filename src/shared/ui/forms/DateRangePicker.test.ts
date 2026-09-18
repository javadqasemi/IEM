import { describe, expect, it } from "vitest";
import { rangePresets } from "./DateRangePicker";

/**
 * The presets, pinned to a fixed clock.
 *
 * Date arithmetic is the classic place for a bug that hides for months: it is
 * correct on the machine that wrote it, in the timezone it was written in, on
 * a day that is not the first of a month.
 */
describe("rangePresets", () => {
  // A Wednesday, 15:30 local, mid-month, mid-year.
  const now = new Date(2026, 2, 18, 15, 30);

  it("offers the four ranges people ask for", () => {
    expect(rangePresets(now).map((p) => p.id)).toEqual(["7", "30", "month", "year"]);
  });

  it("ends every range today", () => {
    for (const preset of rangePresets(now)) {
      expect(preset.range.to).toBe("2026-03-18");
    }
  });

  /**
   * Inclusive. "7 Tage" that returned eight days of rows would be wrong in the
   * direction nobody checks.
   */
  it("counts seven days including today", () => {
    expect(rangePresets(now)[0].range.from).toBe("2026-03-12");
  });

  it("counts thirty days including today", () => {
    expect(rangePresets(now)[1].range.from).toBe("2026-02-17");
  });

  it("starts the month on the first", () => {
    expect(rangePresets(now)[2].range.from).toBe("2026-03-01");
  });

  it("starts the year on 1 January", () => {
    expect(rangePresets(now)[3].range.from).toBe("2026-01-01");
  });

  /**
   * The bug `toISOString()` alone would produce.
   *
   * Anywhere east of Greenwich, a local date after midnight UTC formats as the
   * *previous* day — in Switzerland that is every evening between 01:00 and
   * 02:00 CET. A "30 Tage" filter that is silently off by one for an hour a
   * night is exactly the kind of thing nobody reports and nobody finds.
   */
  it("uses the local day, not the UTC day", () => {
    const lateEvening = new Date(2026, 2, 18, 23, 45);
    expect(rangePresets(lateEvening)[0].range.to).toBe("2026-03-18");
  });

  it("crosses a month boundary backwards", () => {
    const firstOfMarch = new Date(2026, 2, 1, 9, 0);
    expect(rangePresets(firstOfMarch)[0].range.from).toBe("2026-02-23");
    expect(rangePresets(firstOfMarch)[2].range.from).toBe("2026-03-01");
  });

  it("crosses a year boundary backwards", () => {
    const newYear = new Date(2026, 0, 3, 9, 0);
    expect(rangePresets(newYear)[1].range.from).toBe("2025-12-05");
    expect(rangePresets(newYear)[3].range.from).toBe("2026-01-01");
  });

  it("handles a leap day", () => {
    const leap = new Date(2028, 1, 29, 9, 0);
    expect(rangePresets(leap)[0].range.to).toBe("2028-02-29");
    expect(rangePresets(leap)[0].range.from).toBe("2028-02-23");
  });
});
