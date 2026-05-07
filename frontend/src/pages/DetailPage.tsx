import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getDocument, retryJob, updateResult, finalizeResult, getExportUrl } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import type { DocumentDetail } from '../types'

const STAGES = [
  { key: 'document_received', label: 'Document received' },
  { key: 'parsing_started', label: 'Parsing started' },
  { key: 'parsing_completed', label: 'Parsing complete' },
  { key: 'extraction_started', label: 'Extraction started' },
  { key: 'extraction_completed', label: 'Extraction complete' },
  { key: 'storing_result', label: 'Storing result' },
  { key: 'job_completed', label: 'Job completed' },
]

const STAGE_ORDER = STAGES.map(s => s.key)

function StageDot({ stage, currentStage, status }: { stage: string; currentStage: string; status: string }) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage)
  const thisIdx = STAGE_ORDER.indexOf(stage)
  if (status === 'failed' && thisIdx === currentIdx) return <div className="stage-dot failed" />
  if (thisIdx < currentIdx || (status === 'completed' && thisIdx <= currentIdx)) return <div className="stage-dot done" />
  if (thisIdx === currentIdx && status === 'processing') return <div className="stage-dot active" />
  return <div className="stage-dot" />
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

  const sseEvent = useSSE(
    detail?.job?.status === 'processing' || detail?.job?.status === 'queued' ? id ?? null : null
  )

  const fetchDetail = async () => {
    if (!id) return
    try {
      const res = await getDocument(id)
      setDetail(res.data)
      const output = res.data.result?.edited_output || res.data.result?.raw_output || {}
      setEditData(output as Record<string, unknown>)
    } catch {
      setAlert({ type: 'error', msg: 'Failed to load document.' })
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchDetail() }, [id])

  // Refresh when SSE signals completion
  useEffect(() => {
    if (sseEvent?.status === 'completed' || sseEvent?.status === 'failed') {
      setTimeout(fetchDetail, 500)
    }
  }, [sseEvent?.status])

  const handleRetry = async () => {
    if (!id) return
    try {
      await retryJob(id)
      await fetchDetail()
      setAlert({ type: 'success', msg: 'Job re-queued.' })
    } catch {
      setAlert({ type: 'error', msg: 'Retry failed.' })
    }
  }

  const handleSave = async () => {
    if (!detail?.result) return
    setSaving(true)
    try {
      await updateResult(detail.result.id, editData)
      setEditing(false)
      await fetchDetail()
      setAlert({ type: 'success', msg: 'Changes saved.' })
    } catch {
      setAlert({ type: 'error', msg: 'Save failed.' })
    } finally { setSaving(false) }
  }

  const handleFinalize = async () => {
    if (!detail?.result) return
    if (!confirm('Finalize this result? It will become read-only.')) return
    try {
      await finalizeResult(detail.result.id)
      await fetchDetail()
      setAlert({ type: 'success', msg: 'Result finalized.' })
    } catch {
      setAlert({ type: 'error', msg: 'Finalization failed.' })
    }
  }

  const progressPct = sseEvent?.progress_pct ?? detail?.job?.progress_pct ?? 0
  const currentStage = sseEvent?.stage ?? detail?.job?.current_stage ?? 'queued'
  const jobStatus = sseEvent?.status ?? detail?.job?.status ?? 'queued'

  if (loading) return <div className="page"><div className="empty-state">Loading...</div></div>
  if (!detail) return <div className="page"><div className="empty-state">Document not found.</div></div>

  const output = detail.result?.edited_output || detail.result?.raw_output
  const isFinalized = detail.result?.finalized ?? false
  const canEdit = !!detail.result && !isFinalized && jobStatus === 'completed'

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-secondary btn-sm mb-16" onClick={() => navigate('/')}>← Back</button>
        <h1 className="page-title">{detail.document.original_name}</h1>
        <p className="page-subtitle text-sm text-muted">
          {detail.document.file_type} · {formatSize(detail.document.file_size)} ·
          Uploaded {new Date(detail.document.created_at).toLocaleString()}
        </p>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type}`}>
          {alert.msg}
          <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setAlert(null)}>✕</button>
        </div>
      )}

      <div className="detail-grid">
        {/* Left: Job status + progress */}
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Processing Status</h2>

          <div className="flex items-center gap-12 mb-16">
            <span className={`badge badge-${jobStatus}`}>
              {{ queued: '⏳ Queued', processing: '⟳ Processing', completed: '✓ Completed', failed: '✗ Failed' }[jobStatus] ?? jobStatus}
            </span>
            {isFinalized && <span className="badge badge-finalized">✓ Finalized</span>}
          </div>

          {(jobStatus === 'processing' || jobStatus === 'completed') && (
            <div className="mb-16">
              <div className="flex justify-between text-sm text-muted mb-8">
                <span>{sseEvent?.message ?? currentStage}</span>
                <span>{progressPct}%</span>
              </div>
              <div className="progress-wrap">
                <div
                  className={`progress-bar ${jobStatus}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {jobStatus === 'failed' && detail.job?.error_message && (
            <div className="alert alert-error text-sm">{detail.job.error_message}</div>
          )}

          <div className="stages">
            {STAGES.map(s => (
              <div key={s.key} className="stage-item">
                <StageDot stage={s.key} currentStage={currentStage} status={jobStatus} />
                <span style={{ color: STAGE_ORDER.indexOf(s.key) <= STAGE_ORDER.indexOf(currentStage) ? '#1a1a1a' : '#999' }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {jobStatus === 'failed' && (
            <button className="btn btn-secondary mt-16" onClick={handleRetry}>
              ↺ Retry ({detail.job?.retry_count ?? 0} attempt{detail.job?.retry_count !== 1 ? 's' : ''})
            </button>
          )}
        </div>

        {/* Right: Result */}
        <div className="card">
          <div className="flex justify-between items-center mb-16">
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Extracted Output</h2>
            <div className="flex gap-8">
              {canEdit && !editing && (
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
              )}
              {canEdit && editing && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setEditData(output as Record<string, unknown> ?? {}) }}>Cancel</button>
                </>
              )}
              {canEdit && !editing && !isFinalized && (
                <button className="btn btn-success btn-sm" onClick={handleFinalize}>Finalize</button>
              )}
            </div>
          </div>

          {!output && jobStatus !== 'completed' ? (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              {jobStatus === 'processing' || jobStatus === 'queued'
                ? 'Processing in progress...'
                : 'No output available.'}
            </div>
          ) : output ? (
            <div>
              {editing ? (
                <div>
                  {Object.entries(editData).map(([key, val]) => (
                    <div className="form-group" key={key}>
                      <label className="form-label">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
                      {typeof val === 'object' ? (
                        <textarea
                          className="form-textarea"
                          value={JSON.stringify(val, null, 2)}
                          onChange={e => {
                            try { setEditData(prev => ({ ...prev, [key]: JSON.parse(e.target.value) })) } catch {}
                          }}
                        />
                      ) : (
                        <input
                          className="form-input"
                          value={String(val)}
                          onChange={e => setEditData(prev => ({ ...prev, [key]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  {Object.entries(output).map(([key, val]) => (
                    <div key={key} style={{ marginBottom: 14 }}>
                      <div className="text-sm" style={{ fontWeight: 500, color: '#444', marginBottom: 3 }}>
                        {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </div>
                      <div style={{ color: '#1a1a1a', fontSize: 14 }}>
                        {Array.isArray(val)
                          ? (val as string[]).map((v, i) => (
                              <span key={i} style={{ display: 'inline-block', background: '#f0f0f0', borderRadius: 4, padding: '2px 8px', marginRight: 4, marginBottom: 4, fontSize: 12 }}>{String(v)}</span>
                            ))
                          : typeof val === 'object'
                          ? <pre className="font-mono text-sm" style={{ background: '#f9f9f9', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(val, null, 2)}</pre>
                          : String(val)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {detail.result && (
                <div className="flex gap-8 mt-24" style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                  <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Export:</span>
                  <a href={getExportUrl(detail.result.id, 'json')} download className="btn btn-secondary btn-sm">⬇ JSON</a>
                  <a href={getExportUrl(detail.result.id, 'csv')} download className="btn btn-secondary btn-sm">⬇ CSV</a>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
