import asyncio
import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis_client import get_async_redis
from app.models.models import Document, Job, Result, JobStatus
from app.schemas.schemas import DocumentDetailOut, DocumentListItem, ResultUpdate, ResultOut, SuggestionItem
from app.services.document_service import document_service
from app.services.file_storage import file_storage
from app.worker.celery_app import process_document_task

router = APIRouter()
results_router = APIRouter()  # Separate router to avoid wildcard /{document_id} conflict

ALLOWED_TYPES = {
    "application/pdf", "text/plain", "text/csv", "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg", "image/png",
}


@router.post("/upload", status_code=201)
async def upload_documents(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    results = []
    for file in files:
        content_type = file.content_type or "application/octet-stream"

        if content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type '{content_type}' for '{file.filename}'. "
                       f"Allowed: {', '.join(sorted(ALLOWED_TYPES))}",
            )

        stored_name, file_path, file_size = await file_storage.save(file)

        max_bytes = 50 * 1024 * 1024
        if file_size > max_bytes:
            file_storage.delete(file_path)
            raise HTTPException(status_code=413, detail=f"'{file.filename}' exceeds 50 MB limit")

        doc = Document(
            filename=stored_name,
            original_name=file.filename,
            file_path=file_path,
            file_type=content_type,
            file_size=file_size,
        )
        db.add(doc)
        await db.flush()

        job = Job(document_id=doc.id)
        db.add(job)
        await db.flush()

        task = process_document_task.delay(
            job.id, doc.id, file_path, content_type, file.filename
        )
        job.celery_task_id = task.id

        results.append({"document_id": doc.id, "job_id": job.id, "filename": file.filename})

    return results


@router.get("", response_model=list[DocumentListItem])
async def list_documents(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await document_service.get_list(db, search, status, sort_by, sort_dir, page, page_size)


@router.get("/suggestions", response_model=list[SuggestionItem])
async def get_suggestions(
    query: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    return await document_service.get_suggestions(db, query, limit)


@router.get("/{document_id}", response_model=DocumentDetailOut)
async def get_document(document_id: str, db: AsyncSession = Depends(get_db)):
    detail = await document_service.get_detail(db, document_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Document not found")
    return detail


@router.get("/{document_id}/progress")
async def stream_progress(document_id: str, db: AsyncSession = Depends(get_db)):
    """SSE endpoint — streams Redis Pub/Sub progress events for a job."""
    detail = await document_service.get_detail(db, document_id)
    if not detail or not detail.job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_id = detail.job.id

    async def event_generator():
        redis = get_async_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"job:{job_id}")

        # Send current state immediately
        current = {
            "job_id": job_id,
            "stage": detail.job.current_stage,
            "progress_pct": detail.job.progress_pct,
            "status": detail.job.status.value,
            "message": f"Current stage: {detail.job.current_stage}",
        }
        yield f"data: {json.dumps(current)}\n\n"

        # If already terminal, close immediately
        if detail.job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
            await pubsub.unsubscribe(f"job:{job_id}")
            return

        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = message["data"]
                    yield f"data: {data}\n\n"
                    parsed = json.loads(data)
                    if parsed.get("status") in ("completed", "failed"):
                        break
                await asyncio.sleep(0)
        finally:
            await pubsub.unsubscribe(f"job:{job_id}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{document_id}/retry", status_code=200)
async def retry_job(document_id: str, db: AsyncSession = Depends(get_db)):
    detail = await document_service.get_detail(db, document_id)
    if not detail or not detail.job:
        raise HTTPException(status_code=404, detail="Job not found")
    if detail.job.status != JobStatus.FAILED:
        raise HTTPException(status_code=400, detail="Only failed jobs can be retried")

    # Load both ORM objects — DocumentOut has no file_path, must read from DB
    doc = await db.get(Document, document_id)
    job = await db.get(Job, detail.job.id)

    job.status = JobStatus.QUEUED
    job.current_stage = "queued"
    job.progress_pct = 0
    job.error_message = None
    await db.flush()

    # Dispatch exactly ONE task
    task = process_document_task.delay(
        job.id, doc.id, doc.file_path, doc.file_type, doc.original_name
    )
    job.celery_task_id = task.id

    return {"job_id": job.id, "status": "queued"}


@results_router.put("/{result_id}", response_model=ResultOut)
async def update_result(result_id: str, body: ResultUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.get(Result, result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    if result.finalized:
        raise HTTPException(status_code=400, detail="Cannot edit a finalized result")
    result.edited_output = body.edited_output
    return result


@results_router.post("/{result_id}/finalize", response_model=ResultOut)
async def finalize_result(result_id: str, db: AsyncSession = Depends(get_db)):
    from datetime import datetime
    result = await db.get(Result, result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    if result.finalized:
        raise HTTPException(status_code=400, detail="Already finalized")
    result.finalized = True
    result.finalized_at = datetime.utcnow()
    return result


@results_router.get("/{result_id}/export")
async def export_result(
    result_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    db: AsyncSession = Depends(get_db),
):
    content, media_type = await document_service.export_result(db, result_id, format)
    ext = "csv" if format == "csv" else "json"
    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=result_{result_id}.{ext}"},
    )
