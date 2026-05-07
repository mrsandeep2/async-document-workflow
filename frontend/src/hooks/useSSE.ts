import { useEffect, useRef, useState } from 'react'
import type { ProgressEvent } from '../types'

const BASE = import.meta.env.VITE_API_URL || ''

export function useSSE(documentId: string | null) {
  const [event, setEvent] = useState<ProgressEvent | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!documentId) return

    const es = new EventSource(`${BASE}/documents/${documentId}/progress`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data: ProgressEvent = JSON.parse(e.data)
        setEvent(data)
        if (data.status === 'completed' || data.status === 'failed') {
          es.close()
        }
      } catch {}
    }

    es.onerror = () => es.close()

    return () => {
      es.close()
      esRef.current = null
    }
  }, [documentId])

  return event
}
