import csv
import io
import json
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, Text
from sqlalchemy.orm import selectinload

from app.models.models import Document, Job, Result, JobStatus
from app.schemas.schemas import DocumentListItem, DocumentDetailOut, DocumentOut, JobOut, ResultOut, SuggestionItem


class DocumentService:

    async def get_list(
        self,
        db: AsyncSession,
        search: Optional[str] = None,
        status: Optional[str] = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 20,
    ):
        query = (
            select(Document, Job, Result)
            .outerjoin(Job, Job.document_id == Document.id)
            .outerjoin(Result, Result.job_id == Job.id)
        )

        if search:
            query = query.where(Document.original_name.ilike(f"%{search}%"))

        if status:
            query = query.where(Job.status == status)

        SORTABLE = {"created_at", "original_name", "file_size", "file_type"}
        if sort_by not in SORTABLE:
            sort_by = "created_at"
        order_col = getattr(Document, sort_by)
        if sort_dir == "desc":
            query = query.order_by(order_col.desc())
        else:
            query = query.order_by(order_col.asc())

        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        rows = (await db.execute(query)).all()

        items = []
        for doc, job, result in rows:
            items.append(DocumentListItem(
                id=doc.id,
                original_name=doc.original_name,
                file_type=doc.file_type,
                file_size=doc.file_size,
                created_at=doc.created_at,
                job_id=job.id if job else None,
                status=job.status if job else None,
                progress_pct=job.progress_pct if job else None,
                finalized=result.finalized if result else None,
            ))
        return items

    async def get_detail(self, db: AsyncSession, document_id: str) -> Optional[DocumentDetailOut]:
        query = (
            select(Document)
            .options(
                selectinload(Document.job).selectinload(Job.result)
            )
            .where(Document.id == document_id)
        )
        doc = (await db.execute(query)).scalar_one_or_none()
        if not doc:
            return None

        return DocumentDetailOut(
            document=DocumentOut.model_validate(doc),
            job=JobOut.model_validate(doc.job) if doc.job else None,
            result=ResultOut.model_validate(doc.job.result) if doc.job and doc.job.result else None,
        )

    async def export_result(self, db: AsyncSession, result_id: str, fmt: str) -> tuple[str, str]:
        """Returns (content, media_type)."""
        result = await db.get(Result, result_id)
        if not result:
            raise ValueError("Result not found")

        output = result.edited_output or result.raw_output or {}

        if fmt == "csv":
            si = io.StringIO()
            writer = csv.writer(si)
            writer.writerow(["field", "value"])
            for k, v in output.items():
                writer.writerow([k, json.dumps(v) if isinstance(v, (list, dict)) else v])
            return si.getvalue(), "text/csv"
        else:
            return json.dumps(output, indent=2), "application/json"

    async def get_suggestions(self, db: AsyncSession, query: str, limit: int = 5) -> list[SuggestionItem]:
        trimmed = query.strip()
        if not trimmed:
            return []

        lowered = trimmed.lower()
        tokens = [t for t in "".join(ch if ch.isalnum() else " " for ch in lowered).split() if t]

        doc_query = (
            select(Document, Result)
            .outerjoin(Job, Job.document_id == Document.id)
            .outerjoin(Result, Result.job_id == Job.id)
            .where(
                or_(
                    Document.original_name.ilike(f"%{trimmed}%"),
                    func.cast(Result.raw_output, Text).ilike(f"%{trimmed}%"),
                    func.cast(Result.edited_output, Text).ilike(f"%{trimmed}%"),
                )
            )
            .limit(50)
        )

        rows = (await db.execute(doc_query)).all()

        suggestions: list[SuggestionItem] = []
        for doc, result in rows:
            name = doc.original_name or ""
            name_lower = name.lower()

            score = 0.0
            match_field = "content"

            if lowered in name_lower:
                score = 1.0
                match_field = "filename"
            else:
                raw = result.raw_output if result and result.raw_output else {}
                edited = result.edited_output if result and result.edited_output else {}
                combined = {**raw, **edited}

                title = str(combined.get("title", "")).lower()
                summary = str(combined.get("summary", "")).lower()
                category = str(combined.get("category", "")).lower()
                keywords = combined.get("keywords", []) or []
                keywords_text = " ".join([str(k).lower() for k in keywords])

                if lowered and (lowered in title or lowered in summary or lowered in category):
                    score = 0.7
                    match_field = "extracted"
                elif tokens and any(t in keywords_text for t in tokens):
                    score = 0.6
                    match_field = "keywords"
                else:
                    fallback_text = json.dumps(combined).lower() if combined else ""
                    if lowered in fallback_text:
                        score = 0.4
                        match_field = "content"

            if score > 0:
                suggestions.append(
                    SuggestionItem(
                        document_id=doc.id,
                        label=name,
                        match_field=match_field,
                        score=score,
                    )
                )

        suggestions.sort(key=lambda item: (-item.score, item.label.lower()))
        return suggestions[:limit]


document_service = DocumentService()
