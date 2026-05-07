import axios from 'axios'
import type { DocumentDetail, DocumentListItem, Result, SuggestionItem } from '../types'

const BASE = import.meta.env.VITE_API_URL || ''
const api = axios.create({ baseURL: BASE })

export const uploadDocuments = (files: File[]) => {
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  return api.post<{ document_id: string; job_id: string; filename: string }[]>(
    '/documents/upload', form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
}

export const listDocuments = (params: {
  search?: string
  status?: string
  sort_by?: string
  sort_dir?: string
  page?: number
  page_size?: number
}) => api.get<DocumentListItem[]>('/documents', { params })

export const getSuggestions = (params: { query: string; limit?: number }) =>
  api.get<SuggestionItem[]>('/documents/suggestions', { params })

export const getDocument = (id: string) =>
  api.get<DocumentDetail>(`/documents/${id}`)

export const retryJob = (documentId: string) =>
  api.post(`/documents/${documentId}/retry`)

export const updateResult = (resultId: string, editedOutput: Record<string, unknown>) =>
  api.put<Result>(`/results/${resultId}`, { edited_output: editedOutput })

export const finalizeResult = (resultId: string) =>
  api.post<Result>(`/results/${resultId}/finalize`)

export const getExportUrl = (resultId: string, format: 'json' | 'csv') =>
  `${BASE}/results/${resultId}/export?format=${format}`
