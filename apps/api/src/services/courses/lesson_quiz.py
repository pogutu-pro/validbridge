"""Server-side scoring for the in-lesson Quiz block.

The Quiz block (`blockQuiz` in the editor) was a client-side self-check: the
correct answers ship to the browser inside the lesson content and the pass/fail
verdict never leaves the page. That is fine for practice and useless as a gate,
because anything the browser decides can be skipped.

To gate on a quiz the server has to be the one that judges it. This module
reads the questions from the stored lesson content (never from the request) and
scores the learner's selected answers against them. The rules mirror the
client component so the learner is never told "correct" by one and refused by
the other: all-or-nothing per question, every gradable question must be right,
and a question with no correct answer marked is skipped rather than failed.
"""

from dataclasses import dataclass, field
from typing import Any

BLOCK_QUIZ_NODE = "blockQuiz"


@dataclass(frozen=True)
class QuizResult:
    passed: bool
    gradable: int
    correct: int
    # One entry per judged question: {"question_id", "correct", "explanation"}.
    # The explanation is only present when that question was answered correctly,
    # because it usually states the answer and must not be readable before then.
    results: list = field(default_factory=list)


def extract_quiz_questions(content: Any) -> list[dict]:
    """Every question of every Quiz block in a lesson, in document order.

    Walks the Tiptap document rather than assuming the block sits at the top
    level, since authors nest blocks inside columns and callouts.
    """
    questions: list[dict] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == BLOCK_QUIZ_NODE:
                attrs = node.get("attrs")
                block_questions = attrs.get("questions") if isinstance(attrs, dict) else None
                if isinstance(block_questions, list):
                    questions.extend(q for q in block_questions if isinstance(q, dict))
            walk(node.get("content"))
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(content)
    return questions


def _gradable(questions: list[dict]) -> list[dict]:
    return [
        q
        for q in questions
        if any(isinstance(a, dict) and a.get("correct") for a in q.get("answers") or [])
    ]


def _chosen_pairs(selected: Any) -> set[tuple[str, str]]:
    chosen: set[tuple[str, str]] = set()
    if isinstance(selected, list):
        for item in selected:
            if isinstance(item, dict):
                qid, aid = item.get("question_id"), item.get("answer_id")
                if isinstance(qid, str) and isinstance(aid, str):
                    chosen.add((qid, aid))
    return chosen


def _question_is_correct(question: dict, chosen: set[tuple[str, str]]) -> bool:
    qid = question.get("question_id")
    answers = [a for a in question.get("answers") or [] if isinstance(a, dict)]
    return all(
        bool(a.get("correct")) == ((qid, a.get("answer_id")) in chosen)
        for a in answers
    )


def check_quiz_question(content: Any, question_id: str, answer_ids: Any) -> dict | None:
    """Judge ONE question, for instant feedback as the learner works through a quiz.

    Returns ``{"correct", "explanation"}``, or ``None`` when the question does not
    exist. The explanation is only included for a correct answer, and a wrong
    answer reveals nothing about which choice was right. A question with no
    answer key cannot be judged, so it counts as correct rather than trapping
    the learner (the final submit skips it the same way).
    """
    question = next(
        (q for q in extract_quiz_questions(content) if q.get("question_id") == question_id),
        None,
    )
    if question is None:
        return None
    if not _gradable([question]):
        return {"correct": True, "explanation": None}
    ids = answer_ids if isinstance(answer_ids, list) else []
    chosen = {(question_id, a) for a in ids if isinstance(a, str)}
    correct = _question_is_correct(question, chosen)
    explanation = question.get("explanation")
    return {
        "correct": correct,
        "explanation": explanation if correct and isinstance(explanation, str) and explanation.strip() else None,
    }


def lesson_has_quiz(content: Any) -> bool:
    """True when the lesson holds at least one question that can be judged.

    A Quiz block with no questions, or none with a correct answer marked, is an
    authoring placeholder. It must not gate the lesson, because no answer could
    ever satisfy it and the learner would be stuck.
    """
    return bool(_gradable(extract_quiz_questions(content)))


def score_lesson_quiz(content: Any, selected: Any) -> QuizResult:
    """Score a learner's answers against the lesson's stored quiz.

    ``selected`` is a list of ``{"question_id", "answer_id"}`` pairs, the same
    shape the client keeps. Anything malformed counts as not selected, so a bad
    payload can only fail the quiz, never pass it.
    """
    chosen: set[tuple[str, str]] = set()
    if isinstance(selected, list):
        for item in selected:
            if isinstance(item, dict):
                qid, aid = item.get("question_id"), item.get("answer_id")
                if isinstance(qid, str) and isinstance(aid, str):
                    chosen.add((qid, aid))

    gradable = _gradable(extract_quiz_questions(content))
    correct = 0
    results: list[dict] = []
    for question in gradable:
        qid = question.get("question_id")
        answers = [a for a in question.get("answers") or [] if isinstance(a, dict)]
        is_correct = all(
            bool(a.get("correct")) == ((qid, a.get("answer_id")) in chosen)
            for a in answers
        )
        if is_correct:
            correct += 1
        explanation = question.get("explanation")
        results.append({
            "question_id": qid,
            "correct": is_correct,
            "explanation": explanation if is_correct and isinstance(explanation, str) and explanation.strip() else None,
        })

    return QuizResult(
        passed=bool(gradable) and correct == len(gradable),
        gradable=len(gradable),
        correct=correct,
        results=results,
    )


def strip_quiz_answer_keys(content: Any) -> Any:
    """A copy of the lesson with every Quiz block's answer key removed.

    Learners get this copy. The key is only needed to judge answers, which the
    server does, so sending it would let anyone read the answers from the
    response and pass without trying. Stored content is untouched.
    """
    import copy

    if not extract_quiz_questions(content):
        return content  # nothing to strip, so nothing worth copying

    out = copy.deepcopy(content)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == BLOCK_QUIZ_NODE and isinstance(node.get("attrs"), dict):
                for q in node["attrs"].get("questions") or []:
                    if isinstance(q, dict):
                        # Explanations usually give the answer away; the server
                        # returns one only after that question is answered right.
                        q.pop("explanation", None)
                        answers = [a for a in q.get("answers") or [] if isinstance(a, dict)]
                        # Questions saved before `response_type` existed let the
                        # page infer pick-one vs pick-several from the key. Stamp
                        # the mode on this copy before the key is removed, or
                        # every such question would turn into pick-one.
                        if q.get("response_type") not in ("single", "multiple"):
                            correct_count = sum(1 for a in answers if a.get("correct"))
                            q["response_type"] = "multiple" if correct_count >= 2 else "single"
                        for a in answers:
                            a.pop("correct", None)
            walk(node.get("content"))
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(out)
    return out
