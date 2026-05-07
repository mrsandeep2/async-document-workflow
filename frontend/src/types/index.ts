export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface DocumentListItem {
  id: string
  original_name: string
  file_type: string
  file_size: number
  created_at: string
  job_id?: string
  status?: JobStatus
  progress_pct?: number
  finalized?: boolean
}

export interface Document {
  id: string
  filename: string
  original_name: string
  file_type: string
  file_size: number
  created_at: string
}

export interface Job {
  id: string
  document_id: string
  status: JobStatus
  current_stage: string
  progress_pct: number
  error_message?: string
  retry_count: number
  created_at: string
  updated_at: string
}

export interface Result {
  id: string
  job_id: string
  raw_output?: Record<string, unknown>
  edited_output?: Record<string, unknown>
  finalized: boolean
  finalized_at?: string
  created_at: string
}

export interface DocumentDetail {
  document: Document
  job?: Job
  result?: Result
}

export interface ProgressEvent {
  job_id: string
  stage: string
  progress_pct: number
  status: string
  message: string
  timestamp: string
}

export interface SuggestionItem {
  document_id: string
  label: string
  match_field: string
  score: number
}
