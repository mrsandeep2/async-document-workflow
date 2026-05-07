from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel
from app.models.models import JobStatus


class DocumentOut(BaseModel):
    id: str
    filename: str
    original_name: str
    file_type: str
    file_size: int
    created_at: datetime

    model_config = {"from_attributes": True}


class JobOut(BaseModel):
    id: str
    document_id: str
    status: JobStatus
    current_stage: str
    progress_pct: int
    error_message: Optional[str] = None
    retry_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResultOut(BaseModel):
    id: str
    job_id: str
    raw_output: Optional[dict] = None
    edited_output: Optional[dict] = None
    finalized: bool
    finalized_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentDetailOut(BaseModel):
    document: DocumentOut
    job: Optional[JobOut] = None
    result: Optional[ResultOut] = None


class DocumentListItem(BaseModel):
    id: str
    original_name: str
    file_type: str
    file_size: int
    created_at: datetime
    job_id: Optional[str] = None
    status: Optional[JobStatus] = None
    progress_pct: Optional[int] = None
    finalized: Optional[bool] = None

    model_config = {"from_attributes": True}


class ResultUpdate(BaseModel):
    edited_output: dict


class ProgressEvent(BaseModel):
    job_id: str
    stage: str
    progress_pct: int
    status: str
    message: str


class SuggestionItem(BaseModel):
    document_id: str
    label: str
    match_field: str
    score: float
