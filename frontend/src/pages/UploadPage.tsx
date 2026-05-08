import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { uploadDocuments } from '../api/client'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => [...prev, ...accepted])
    setError(null)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxSize: 50 * 1024 * 1024,
  })

  const removeFile = (i: number) => setFiles(f => f.filter((_, idx) => idx !== i))

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      await uploadDocuments(files)
      navigate('/')
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Upload documents</h1>
        <p className="page-subtitle">Drop files to trigger background processing and structured extraction.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="split-layout">
        <div className="card">
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            <div className="dropzone-icon">📂</div>
            <p className="dropzone-title">
              {isDragActive ? 'Drop files here' : 'Drag & drop files here, or click to browse'}
            </p>
            <p className="dropzone-sub">PDF, TXT, CSV, DOCX, XLSX, JPG, PNG — up to 50MB each</p>
          </div>

          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => (
                <div key={i} className="file-item">
                  <div>
                    <div className="file-item-name">{f.name}</div>
                    <div className="file-item-size">{formatSize(f.size)}</div>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={() => removeFile(i)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-24 flex gap-12">
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={!files.length || uploading}
            >
              {uploading ? 'Uploading...' : `Upload ${files.length ? `(${files.length} file${files.length > 1 ? 's' : ''})` : ''}`}
            </button>
            {files.length > 0 && (
              <button className="btn btn-secondary" onClick={() => setFiles([])}>Clear all</button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="side-card-title">What you get</div>
          <div className="side-list">
            <div><strong>Metadata</strong> (name, type, size) stored in the database.</div>
            <div><strong>Structured fields</strong> (title, category, summary, keywords).</div>
            <div><strong>Export-ready results</strong> in JSON or CSV after review.</div>
          </div>
          <div className="mt-16" style={{ color: '#8a7c6a', fontSize: 13 }}>
            Tip: upload in batches to compare results side-by-side.
          </div>
        </div>
      </div>
    </div>
  )
}
