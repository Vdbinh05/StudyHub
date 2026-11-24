import { describe, expect, it } from "vitest";
import { clamp, cn, formatDuration } from "@/lib/utils";
import { getDictionary, translate } from "@/lib/i18n";

describe("utils", () => {
  it("merges tailwind classes deterministically with cn", () => {
    expect(cn("px-2 py-1", "px-4", false && "hidden")).toBe("py-1 px-4");
  });

  it("formats durations cleanly for MM:SS and HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(-10)).toBe("00:00");
  });

  it("clamps numbers to [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("i18n", () => {
  it("resolves Vietnamese default and English translations with interpolation", () => {
    expect(translate("vi", "nav.library")).toBe("Thư viện");
    expect(translate("en", "nav.library")).toBe("Library");
    expect(translate("vi", "library.questionsCount", { count: 25 })).toBe(
      "25 câu hỏi",
    );
    expect(translate("en", "library.questionsCount", { count: 25 })).toBe(
      "25 questions",
    );
  });

  it("keeps Vietnamese and English dictionary sections aligned", () => {
    const vi = getDictionary("vi");
    const en = getDictionary("en");
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  });
});
