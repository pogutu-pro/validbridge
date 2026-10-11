"""Tests for server-side scoring of the in-lesson Quiz block.

A quiz verdict that gates progression must be decided by the server, and any
malformed input must fail the quiz rather than pass it.
"""

from src.services.courses.lesson_quiz import (
    lesson_has_quiz,
    score_lesson_quiz,
)


def _quiz(*questions):
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph"},
            {"type": "blockQuiz", "attrs": {"quizId": "q", "questions": list(questions)}},
        ],
    }


def _question(qid, correct_ids, all_ids=("a", "b", "c")):
    return {
        "question_id": qid,
        "question": "?",
        "type": "multiple_choice",
        "answers": [
            {"answer_id": aid, "answer": aid, "correct": aid in correct_ids}
            for aid in all_ids
        ],
    }


def _pick(qid, *answer_ids):
    return [{"question_id": qid, "answer_id": a} for a in answer_ids]


class TestLessonHasQuiz:
    def test_plain_lesson_has_no_quiz(self):
        assert lesson_has_quiz({"type": "doc", "content": [{"type": "paragraph"}]}) is False

    def test_garbage_content_has_no_quiz(self):
        assert lesson_has_quiz(None) is False
        assert lesson_has_quiz("text") is False

    def test_quiz_with_a_key_gates(self):
        assert lesson_has_quiz(_quiz(_question("q1", {"a"}))) is True

    def test_placeholder_quiz_does_not_gate(self):
        # No correct answer marked: nothing could ever satisfy it.
        assert lesson_has_quiz(_quiz(_question("q1", set()))) is False
        assert lesson_has_quiz(_quiz()) is False

    def test_nested_quiz_is_found(self):
        nested = {"type": "doc", "content": [{"type": "column", "content": [_quiz(_question("q1", {"a"}))]}]}
        assert lesson_has_quiz(nested) is True


class TestScoring:
    def test_correct_single_answer_passes(self):
        content = _quiz(_question("q1", {"b"}))
        assert score_lesson_quiz(content, _pick("q1", "b")).passed is True

    def test_wrong_answer_fails(self):
        content = _quiz(_question("q1", {"b"}))
        assert score_lesson_quiz(content, _pick("q1", "a")).passed is False

    def test_no_answer_fails(self):
        content = _quiz(_question("q1", {"b"}))
        assert score_lesson_quiz(content, []).passed is False

    def test_multiple_response_is_all_or_nothing(self):
        content = _quiz(_question("q1", {"a", "b"}))
        assert score_lesson_quiz(content, _pick("q1", "a", "b")).passed is True
        assert score_lesson_quiz(content, _pick("q1", "a")).passed is False
        assert score_lesson_quiz(content, _pick("q1", "a", "b", "c")).passed is False

    def test_every_question_must_be_right(self):
        content = _quiz(_question("q1", {"a"}), _question("q2", {"c"}))
        both = _pick("q1", "a") + _pick("q2", "c")
        assert score_lesson_quiz(content, both).passed is True
        result = score_lesson_quiz(content, _pick("q1", "a") + _pick("q2", "a"))
        assert result.passed is False
        assert (result.correct, result.gradable) == (1, 2)

    def test_unkeyed_question_is_skipped_not_failed(self):
        content = _quiz(_question("q1", {"a"}), _question("q2", set()))
        assert score_lesson_quiz(content, _pick("q1", "a")).passed is True

    def test_malformed_payload_can_only_fail(self):
        content = _quiz(_question("q1", {"a"}))
        for bad in (None, "a", 1, [None], [{"question_id": 1, "answer_id": 2}], {"q1": "a"}):
            assert score_lesson_quiz(content, bad).passed is False

    def test_lesson_without_a_quiz_never_passes_by_scoring(self):
        # Nothing to judge: callers must not treat this as a pass verdict.
        assert score_lesson_quiz({"type": "doc"}, []).passed is False


class TestStripAnswerKeys:
    def test_key_removed_from_copy_only(self):
        from src.services.courses.lesson_quiz import strip_quiz_answer_keys

        content = _quiz(_question("q1", {"a"}))
        stripped = strip_quiz_answer_keys(content)
        answers = stripped["content"][1]["attrs"]["questions"][0]["answers"]
        assert all("correct" not in a for a in answers)
        # Original (stored) content still scores.
        assert score_lesson_quiz(content, _pick("q1", "a")).passed is True

    def test_content_without_a_quiz_is_returned_as_is(self):
        from src.services.courses.lesson_quiz import strip_quiz_answer_keys

        plain = {"type": "doc", "content": [{"type": "paragraph"}]}
        assert strip_quiz_answer_keys(plain) is plain

    def test_response_mode_survives_key_removal(self):
        """An older question has no response_type; the page inferred it from the key."""
        from src.services.courses.lesson_quiz import strip_quiz_answer_keys

        multi = _question("m", {"a", "b"})
        single = _question("s", {"a"})
        explicit = {**_question("e", {"a"}), "response_type": "multiple"}
        stripped = strip_quiz_answer_keys(_quiz(multi, single, explicit))
        modes = {q["question_id"]: q["response_type"] for q in stripped["content"][1]["attrs"]["questions"]}
        assert modes == {"m": "multiple", "s": "single", "e": "multiple"}
        # The stored content is not modified.
        assert "response_type" not in multi


class TestExplanations:
    def _with_explanation(self, qid, correct_ids, text):
        return {**_question(qid, correct_ids), "explanation": text}

    def test_explanation_is_returned_only_for_a_correct_answer(self):
        content = _quiz(
            self._with_explanation("q1", {"a"}, "Because a."),
            self._with_explanation("q2", {"b"}, "Because b."),
        )
        result = score_lesson_quiz(content, _pick("q1", "a") + _pick("q2", "c"))
        by_id = {r["question_id"]: r for r in result.results}
        assert by_id["q1"] == {"question_id": "q1", "correct": True, "explanation": "Because a."}
        # Wrong answer: no explanation, which would give the answer away.
        assert by_id["q2"]["correct"] is False and by_id["q2"]["explanation"] is None

    def test_blank_or_missing_explanation_is_none(self):
        content = _quiz(self._with_explanation("q1", {"a"}, "  "), _question("q2", {"a"}))
        result = score_lesson_quiz(content, _pick("q1", "a") + _pick("q2", "a"))
        assert [r["explanation"] for r in result.results] == [None, None]

    def test_explanation_is_not_sent_to_learners(self):
        from src.services.courses.lesson_quiz import strip_quiz_answer_keys

        content = _quiz(self._with_explanation("q1", {"a"}, "Because a."))
        stripped = strip_quiz_answer_keys(content)
        assert "explanation" not in stripped["content"][1]["attrs"]["questions"][0]
        # Stored content keeps it so it can still be returned after a correct answer.
        assert content["content"][1]["attrs"]["questions"][0]["explanation"] == "Because a."
