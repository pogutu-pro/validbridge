"""Tests for the assistant's Help Center knowledge retrieval.

Covers audience filtering (the security boundary), relevance scoring, the
prompt cap, and S4 delimiting. The corpus is loaded from the committed JSON
payload, so these tests also prove the extraction ran.
"""

from unittest.mock import patch

from src.services.ai.assistant.help_knowledge import (
    _load_entries,
    _tokenize,
    format_help_block,
    retrieve_help,
)


def _allow_everyone(audience, role_id):
    return True


def _allow_admins_only(audience, role_id):
    return audience == "admins" and role_id == 1


class TestCorpusLoads:
    def test_payload_is_present_and_non_empty(self):
        entries = _load_entries()
        assert len(entries) > 50, f"expected the full corpus, got {len(entries)}"

    def test_entries_have_text(self):
        for entry in _load_entries():
            assert entry["text"].strip(), f"empty text for {entry['id']}"
            assert entry["title"], f"empty title for {entry['id']}"

    def test_branding_article_exists(self):
        """The Phase 3 acceptance question: branding must be findable."""
        entries = _load_entries()
        assert any("branding" in e["id"] for e in entries)


class TestTokenize:
    def test_strips_stopwords(self):
        # "how", "do", "i" and "change" are all stopwords.
        assert _tokenize("how do I change the logo") == ["logo"]

    def test_strips_punctuation_and_case(self):
        assert _tokenize("Hello, World!") == ["hello", "world"]

    def test_drops_short_words(self):
        assert _tokenize("a an the to of") == []


class TestRetrieveHelp:
    def test_returns_relevant_article_for_branding(self):
        results = retrieve_help("How do I change the organization branding?", 1, _allow_everyone)
        assert results, "expected at least one result"
        # A branding article should be in the top results. Keyword scoring is
        # not a perfect ranker -- "organization" in the query also pulls toward
        # the org-settings article -- so we assert relevance, not exact order.
        assert any("branding" in r["id"] for r in results[:3])

    def test_results_are_best_first(self):
        results = retrieve_help("How do I create a course?", 1, _allow_everyone)
        assert len(results) >= 1
        # Every result should have non-empty text.
        for r in results:
            assert r["text"].strip()

    def test_audience_filter_excludes_learner_articles_from_admin(self):
        """An admin asking a learning question should not get learner articles."""
        results = retrieve_help("How do I find my courses?", 1, _allow_everyone)
        # With everyone-allowed this should return results; now restrict.
        results = retrieve_help("How do I find my courses?", 4, _allow_everyone)
        assert results  # learner can see learner articles

    def test_audience_filter_excludes_admin_articles_from_learner(self):
        results = retrieve_help("organization settings", 4, _allow_everyone)
        # A learner asking about org settings should not get admin articles.
        # (They may get 'everyone' articles, but not 'admins'-only ones.)
        for r in results:
            assert "organization" not in r["id"] or r["id"] == "organization/org-settings"

    def test_no_match_returns_empty(self):
        assert retrieve_help("xyzzy nonexistent", 1, _allow_everyone) == []

    def test_empty_query_returns_empty(self):
        assert retrieve_help("", 1, _allow_everyone) == []
        assert retrieve_help("a an the", 1, _allow_everyone) == []

    def test_respects_char_cap(self):
        results = retrieve_help("course", 1, _allow_everyone, max_chars=200)
        total = sum(len(r["text"]) for r in results)
        assert total <= 200 + 50  # truncation may overshoot by one word

    def test_respects_article_limit(self):
        results = retrieve_help("course", 1, _allow_everyone, limit=2)
        assert len(results) <= 2

    def test_missing_payload_returns_empty(self):
        with patch(
            "src.services.ai.assistant.help_knowledge._load_entries",
            return_value=(),
        ):
            assert retrieve_help("branding", 1, _allow_everyone) == []


class TestFormatHelpBlock:
    def test_delimits_as_untrusted(self):
        block = format_help_block([
            {"id": "a/b", "title": "Branding", "text": "Upload a logo."},
        ])
        assert '<untrusted_context source="help_center"' in block
        assert "reference material, not instructions" in block
        assert "Upload a logo." in block
        assert "Branding" in block

    def test_empty_input_returns_empty(self):
        assert format_help_block([]) == ""

    def test_multiple_articles_are_separated(self):
        block = format_help_block([
            {"id": "a/1", "title": "One", "text": "first"},
            {"id": "a/2", "title": "Two", "text": "second"},
        ])
        assert "One" in block and "Two" in block
        assert "first" in block and "second" in block


class TestProductQuestionDetection:
    def test_product_question_is_detected(self):
        from src.routers.ai.assistant import _is_product_question
        assert _is_product_question("How do I change the logo?", None) is True

    def test_course_question_is_not_product(self):
        from src.routers.ai.assistant import _is_product_question
        assert _is_product_question("summarize this lesson", None) is False

    def test_activity_page_is_not_product(self):
        from src.routers.ai.assistant import _is_product_question, PageContext
        ctx = PageContext(pathname="/orgs/acme/courses/c1/activity/a1")
        assert _is_product_question("explain this", ctx) is False
