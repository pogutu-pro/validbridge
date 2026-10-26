import { describe, expect, test } from "bun:test";

import { hasAnswer } from "../components/Objects/Activities/Exam/hasAnswer.ts";

describe("hasAnswer (exam question navigator)", () => {
  test("nothing saved is not an answer", () => {
    expect(hasAnswer(undefined)).toBe(false);
    expect(hasAnswer(null)).toBe(false);
    expect(hasAnswer({})).toBe(false);
    expect(hasAnswer([])).toBe(false);
  });

  test("blank text and an unticked box are not answers", () => {
    expect(hasAnswer("")).toBe(false);
    expect(hasAnswer("   ")).toBe(false);
    expect(hasAnswer({ answer: "  " })).toBe(false);
    expect(hasAnswer(false)).toBe(false);
  });

  test("text, numbers (including zero) and ticked options count", () => {
    expect(hasAnswer({ answer: "Nairobi" })).toBe(true);
    expect(hasAnswer({ value: 0 })).toBe(true);
    expect(hasAnswer({ selected: [false, true] })).toBe(true);
    expect(hasAnswer({ blanks: { a: "", b: "x" } })).toBe(true);
  });

  test("a list of empty things is not an answer", () => {
    expect(hasAnswer({ selected: [false, false] })).toBe(false);
    expect(hasAnswer({ blanks: { a: "", b: "" } })).toBe(false);
  });
});
