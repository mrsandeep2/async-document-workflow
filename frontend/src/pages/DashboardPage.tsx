import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDocuments, getSuggestions } from '../api/client'
import type { DocumentListItem, JobStatus, SuggestionItem } from '../types'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusBadge({ status, finalized }: { status?: JobStatus; finalized?: boolean }) {
  if (finalized) return <span className="badge badge-finalized">✓ Finalized</span>
  if (!status) return <span className="badge badge-queued">—</span>
  const map: Record<JobStatus, string> = {
    queued: 'badge-queued',
    processing: 'badge-processing',
    completed: 'badge-completed',
    failed: 'badge-failed',
  }
  const labels: Record<JobStatus, string> = {
    queued: '⏳ Queued',
    processing: '⟳ Processing',
    completed: '✓ Completed',
    failed: '✗ Failed',
  }
  return <span className={`badge ${map[status]}`}>{labels[status]}</span>
}

export default function DashboardPage() {
  const [docs, setDocs] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const navigate = useNavigate()

  const totalDocs = docs.length
  const completedCount = docs.filter(doc => doc.status === 'completed').length
  const processingCount = docs.filter(doc => doc.status === 'processing').length
  const failedCount = docs.filter(doc => doc.status === 'failed').length

  const fetchDocs = useCallback(async () => {
    try {
      const res = await listDocuments({ search, status: statusFilter || undefined, sort_by: sortBy, sort_dir: sortDir })
      setDocs(res.data)
    } catch {}
    finally { setLoading(false) }
  }, [search, statusFilter, sortBy, sortDir])

  useEffect(() => {
    fetchDocs()
    const interval = setInterval(fetchDocs, 5000)
    return () => clearInterval(interval)
  }, [fetchDocs])

  useEffect(() => {
    const trimmed = search.trim()
    if (trimmed.length < 1) {
      setSuggestions([])
      setSuggestionsOpen(false)
      return
    }

    const handle = setTimeout(async () => {
      setSuggestionsLoading(true)
      try {
        const res = await getSuggestions({ query: trimmed, limit: 6 })
        setSuggestions(res.data)
        setSuggestionsOpen(true)
      } catch {
        setSuggestions([])
        setSuggestionsOpen(false)
      } finally {
        setSuggestionsLoading(false)
      }
    }, 200)

    return () => clearTimeout(handle)
  }, [search])

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1 className="hero-title">Document intake, ready for review.</h1>
          <p className="hero-subtitle">
            Centralize documents with live processing updates and instant export-ready summaries.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => navigate('/upload')}>+ Upload documents</button>
            <button className="btn btn-secondary" onClick={fetchDocs}>Refresh view</button>
          </div>
          <div className="hero-pills">
            <span className="pill">Clean exports</span>
            <span className="pill">Human-readable output</span>
            <span className="pill">Live status updates</span>
          </div>
        </div>
        <div className="hero-card">
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Total files</div>
              <div className="stat-value">{totalDocs}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Completed</div>
              <div className="stat-value">{completedCount}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">In progress</div>
              <div className="stat-value">{processingCount}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Needs review</div>
              <div className="stat-value">{failedCount}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="suggestions-wrap">
          <input
            className="form-input"
            placeholder="Search by filename or content..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
            onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
          />
          {suggestionsOpen && (suggestionsLoading || suggestions.length > 0) && (
            <div className="suggestions-popover">
              {suggestionsLoading ? (
                <div className="suggestion-item muted">Searching...</div>
              ) : (
                suggestions.map(item => (
                  <button
                    key={item.document_id}
                    className="suggestion-item"
                    onMouseDown={() => {
                      setSuggestionsOpen(false)
                      navigate(`/documents/${item.document_id}`)
                    }}
                  >
                    <span className="suggestion-title">{item.label}</span>
                    <span className="suggestion-meta">{item.match_field}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select className="form-select" value={`${sortBy}:${sortDir}`} onChange={e => {
          const [by, dir] = e.target.value.split(':')
          setSortBy(by); setSortDir(dir)
        }}>
          <option value="created_at:desc">Newest first</option>
          <option value="created_at:asc">Oldest first</option>
          <option value="original_name:asc">Name A→Z</option>
          <option value="original_name:desc">Name Z→A</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={fetchDocs}>Refresh</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="empty-state">
            <p>No documents yet.</p>
            <button className="btn btn-primary mt-16" onClick={() => navigate('/upload')}>Upload your first document</button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Size</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id}>
                  <td>
                    <span className="table-link" onClick={() => navigate(`/documents/${doc.id}`)}>
                      {doc.original_name}
                    </span>
                  </td>
                  <td className="text-muted text-sm">{doc.file_type.split('/').pop()}</td>
                  <td className="text-muted text-sm">{formatSize(doc.file_size)}</td>
                  <td><StatusBadge status={doc.status} finalized={doc.finalized ?? false} /></td>
                  <td style={{ minWidth: 120 }}>
                    {doc.status === 'processing' && (
                      <div>
                        <div className="progress-wrap">
                          <div className="progress-bar" style={{ width: `${doc.progress_pct ?? 0}%` }} />
                        </div>
                        <span className="text-muted text-sm">{doc.progress_pct}%</span>
                      </div>
                    )}
                  </td>
                  <td className="text-muted text-sm">
                    {new Date(doc.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
