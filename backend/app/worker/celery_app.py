import json
import time
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

from celery import Celery
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.core.config import settings
from app.core.redis_client import get_sync_redis
from app.models.models import Job, Result, JobStatus

celery_app = Celery(
    "docprocessor",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,
)

# Sync SQLAlchemy for use inside Celery tasks
sync_engine = create_engine(settings.SYNC_DATABASE_URL)
SyncSession = sessionmaker(sync_engine)


def publish_progress(job_id: str, stage: str, pct: int, status: str, message: str):
    r = get_sync_redis()
    payload = json.dumps({
        "job_id": job_id,
        "stage": stage,
        "progress_pct": pct,
        "status": status,
        "message": message,
        "timestamp": datetime.utcnow().isoformat(),
    })
    r.publish(f"job:{job_id}", payload)


def update_job(db: Session, job: Job, stage: str, pct: int, status: JobStatus, error: str = None):
    """Update job fields only — caller is responsible for committing."""
    job.current_stage = stage
    job.progress_pct = pct
    job.status = status
    job.updated_at = datetime.utcnow()
    if error:
        job.error_message = error


def extract_text_from_file(file_path: str, file_type: str) -> str:
    """Extract text content from document. Real extraction for PDF/txt, mock for others."""
    path = Path(file_path)
    if not path.exists():
        return ""

    if file_type in ("text/plain", "text/csv", "text/markdown"):
        try:
            return path.read_text(errors="ignore")[:5000]
        except Exception:
            return ""

    if file_type == "application/pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            text = ""
            for page in reader.pages[:10]:
                text += page.extract_text() or ""
            return text[:5000]
        except Exception:
            return f"[PDF content from {path.name}]"

    # For docx, xlsx, images, etc. — mock content
    return f"[Simulated content extracted from {path.name} ({file_type})]"


def extract_keywords(text: str, top_n: int = 10) -> list[str]:
    """Simple frequency-based keyword extraction."""
    stopwords = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "this", "that", "these", "those", "it", "its",
        "as", "not", "no", "so", "if", "then", "than", "more", "also", "can",
    }
    words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
    filtered = [w for w in words if w not in stopwords]
    counter = Counter(filtered)
    return [word for word, _ in counter.most_common(top_n)]


def infer_category(text: str, filename: str) -> str:
    name = filename.lower()
    text_lower = text.lower()
    if any(k in name or k in text_lower for k in ["invoice", "billing", "payment", "receipt"]):
        return "invoice"
    if any(k in name or k in text_lower for k in ["contract", "agreement", "terms", "legal"]):
        return "contract"
    if any(k in name or k in text_lower for k in ["report", "analysis", "summary", "review"]):
        return "report"
    return "other"


@celery_app.task(
    bind=True,
    name="process_document",
    max_retries=3,
    default_retry_delay=5,
)
def process_document_task(self, job_id: str, document_id: str, file_path: str, file_type: str, original_name: str):
    db = SyncSession()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        # ── Stage 1: document received ──────────────────────────────────
        update_job(db, job, "document_received", 5, JobStatus.PROCESSING)
        db.commit()
        publish_progress(job_id, "document_received", 5, "processing", "Document received")
        time.sleep(0.5)

        # ── Stage 2: parsing started ─────────────────────────────────────
        update_job(db, job, "parsing_started", 20, JobStatus.PROCESSING)
        db.commit()
        publish_progress(job_id, "parsing_started", 20, "processing", "Parsing document...")
        time.sleep(0.8)

        text = extract_text_from_file(file_path, file_type)

        # ── Stage 3: parsing completed ────────────────────────────────────
        update_job(db, job, "parsing_completed", 40, JobStatus.PROCESSING)
        db.commit()
        publish_progress(job_id, "parsing_completed", 40, "processing", "Parsing complete")
        time.sleep(0.5)

        # ── Stage 4: extraction started ───────────────────────────────────
        update_job(db, job, "extraction_started", 55, JobStatus.PROCESSING)
        db.commit()
        publish_progress(job_id, "extraction_started", 55, "processing", "Extracting fields...")
        time.sleep(0.8)

        keywords = extract_keywords(text)
        category = infer_category(text, original_name)
        title = Path(original_name).stem.replace("_", " ").replace("-", " ").title()
        word_count = len(text.split())
        summary = (text[:300] + "...") if len(text) > 300 else text or "[No text content extracted]"

        structured_output = {
            "title": title,
            "category": category,
            "summary": summary,
            "keywords": keywords,
            "word_count": word_count,
            "file_metadata": {
                "original_name": original_name,
                "file_type": file_type,
                "processed_at": datetime.utcnow().isoformat(),
            },
        }

        # ── Stage 5: extraction completed ─────────────────────────────────
        update_job(db, job, "extraction_completed", 75, JobStatus.PROCESSING)
        db.commit()
        publish_progress(job_id, "extraction_completed", 75, "processing", "Fields extracted")
        time.sleep(0.5)

        # ── Stage 6: store result ──────────────────────────────────────────
        update_job(db, job, "storing_result", 90, JobStatus.PROCESSING)
        db.commit()
        publish_progress(job_id, "storing_result", 90, "processing", "Storing result...")

        result = Result(job_id=job_id, raw_output=structured_output)
        db.add(result)

        # ── Stage 7: job completed ─────────────────────────────────────────
        update_job(db, job, "job_completed", 100, JobStatus.COMPLETED)
        db.commit()
        publish_progress(job_id, "job_completed", 100, "completed", "Processing complete")

    except Exception as exc:
        db.rollback()
        try:
            job = db.get(Job, job_id)
            if job:
                job.retry_count = self.request.retries + 1
                update_job(db, job, "job_failed", job.progress_pct, JobStatus.FAILED, str(exc))
                db.commit()
                publish_progress(job_id, "job_failed", job.progress_pct, "failed", f"Error: {exc}")
        except Exception:
            db.rollback()

        # Retry if under limit, otherwise leave as FAILED
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=5 * (2 ** self.request.retries))
    finally:
        db.close()
