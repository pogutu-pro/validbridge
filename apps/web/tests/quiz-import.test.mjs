import { describe, expect, test } from "bun:test";

import { convertImportedQuiz } from "../lib/quiz/importQuiz.ts";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

const sample = [
  {
    stage: "pre",
    question: "Why do AI projects need a separate virtual environment?",
    options: [
      "Virtual environments make code run faster",
      "They isolate dependencies so different projects don't conflict",
      "Python requires virtual environments to import packages",
      "Virtual environments provide GPU access",
    ],
    correct: 1,
    explanation: "Virtual environments isolate package versions per project.",
  },
];

describe("convertImportedQuiz", () => {
  test("converts the simple authoring shape and marks the right option", () => {
    const { questions, skipped } = convertImportedQuiz(sample, ids());
    expect(skipped).toBe(0);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.answers.map((a) => a.correct)).toEqual([false, true, false, false]);
    expect(q.response_type).toBe("single");
    expect(q.explanation).toBe("Virtual environments isolate package versions per project.");
    // Extra keys such as `stage` are not carried over.
    expect(q.stage).toBeUndefined();
  });

  test("accepts a { questions: [...] } wrapper", () => {
    expect(convertImportedQuiz({ questions: sample }, ids()).questions).toHaveLength(1);
  });

  test("several correct indexes make a pick-several question", () => {
    const { questions } = convertImportedQuiz(
      [{ question: "Pick", options: ["a", "b", "c"], correct: [0, 2] }],
      ids()
    );
    expect(questions[0].response_type).toBe("multiple");
    expect(questions[0].answers.map((a) => a.correct)).toEqual([true, false, true]);
  });

  test("skips unusable questions instead of importing them half-built", () => {
    const { questions, skipped } = convertImportedQuiz(
      [
        { question: "", options: ["a", "b"], correct: 0 },
        { question: "one option", options: ["a"], correct: 0 },
        { question: "no key", options: ["a", "b"] },
        { question: "bad index", options: ["a", "b"], correct: 9 },
        { question: "ok", options: ["a", "b"], correct: 1 },
      ],
      ids()
    );
    expect(questions.map((q) => q.question)).toEqual(["ok"]);
    expect(skipped).toBe(4);
  });

  test("rejects input that is not a list of questions", () => {
    expect(() => convertImportedQuiz("nope", ids())).toThrow();
    expect(() => convertImportedQuiz({ foo: 1 }, ids())).toThrow();
  });
});
