import { describe, expect, test } from "bun:test";

import { countQuizQuestions } from "../lib/quiz/countQuizQuestions.ts";

const quiz = (n) => ({
  type: "blockQuiz",
  attrs: { questions: Array.from({ length: n }, (_, i) => ({ question_id: `q${i}` })) },
});

describe("countQuizQuestions", () => {
  test("is zero for a lesson with no quiz or unusable content", () => {
    expect(countQuizQuestions({ type: "doc", content: [{ type: "paragraph" }] })).toBe(0);
    expect(countQuizQuestions(null)).toBe(0);
    expect(countQuizQuestions({})).toBe(0);
    expect(countQuizQuestions("text")).toBe(0);
  });

  test("an empty quiz block does not count as a quiz", () => {
    expect(countQuizQuestions({ type: "doc", content: [quiz(0)] })).toBe(0);
  });

  test("counts questions, including inside nested blocks and several quiz blocks", () => {
    const doc = {
      type: "doc",
      content: [quiz(2), { type: "column", content: [quiz(3)] }],
    };
    expect(countQuizQuestions(doc)).toBe(5);
  });
});
