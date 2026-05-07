"""
Tests for document processing worker and API.
Run with: pytest tests/ -v
"""
import json
import pytest
from unittest.mock import patch, MagicMock
from app.worker.celery_app import extract_keywords, extract_text_from_file, infer_category


class TestExtractKeywords:
    def test_returns_top_words(self):
        text = "machine learning model training data machine learning algorithm"
        keywords = extract_keywords(text, top_n=3)
        assert "machine" in keywords
        assert "learning" in keywords
        assert len(keywords) <= 3

    def test_excludes_stopwords(self):
        text = "the quick brown fox jumps over the lazy dog"
        keywords = extract_keywords(text)
        assert "the" not in keywords
        assert "over" not in keywords

    def test_empty_text(self):
        assert extract_keywords("") == []

    def test_min_word_length(self):
        text = "a is of go to run fast"
        keywords = extract_keywords(text)
        for k in keywords:
            assert len(k) >= 3


class TestInferCategory:
    def test_invoice_detection(self):
        assert infer_category("total invoice amount due payment", "invoice_001.pdf") == "invoice"

    def test_contract_detection(self):
        assert infer_category("this agreement contract terms", "contract.docx") == "contract"

    def test_report_detection(self):
        assert infer_category("quarterly summary report analysis", "q3_report.txt") == "report"

    def test_default_other(self):
        assert infer_category("hello world random content", "notes.txt") == "other"


class TestTextExtraction:
    def test_missing_file_returns_empty(self):
        result = extract_text_from_file("/nonexistent/path/file.txt", "text/plain")
        assert result == ""

    def test_txt_file(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("Hello world this is a test document")
        result = extract_text_from_file(str(f), "text/plain")
        assert "Hello world" in result

    def test_unsupported_type_returns_mock(self, tmp_path):
        f = tmp_path / "test.docx"
        f.write_bytes(b"fake docx content")
        result = extract_text_from_file(str(f), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        assert "test.docx" in result


class TestProgressPublishing:
    def test_publish_progress_format(self):
        published = []

        class MockRedis:
            def publish(self, channel, payload):
                published.append((channel, json.loads(payload)))

        with patch("app.worker.celery_app.get_sync_redis", return_value=MockRedis()):
            from app.worker.celery_app import publish_progress
            publish_progress("job-123", "parsing_started", 20, "processing", "Parsing...")

        assert len(published) == 1
        channel, payload = published[0]
        assert channel == "job:job-123"
        assert payload["job_id"] == "job-123"
        assert payload["stage"] == "parsing_started"
        assert payload["progress_pct"] == 20
        assert payload["status"] == "processing"
