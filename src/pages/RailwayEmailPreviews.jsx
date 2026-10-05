import { useState } from 'react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabase'

export default function RailwayEmailPreviews() {
  const [previews, setPreviews] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('email-previews', { body: {} })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setPreviews(data?.previews || [])
    setMessage(data?.previews?.length ? '' : 'No pending emails or previews.')
  }
  async function retry(id) {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('retry-email', { body: { job_id: id } })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    await refresh()
    setMessage(`Email job status: ${data.status}`)
  }
  return <section style={{ padding: '1rem', marginBottom: '1rem', background: '#fff8df', borderRadius: 8 }}>
    <h3>Email queue and previews</h3>
    <p>Previews are never sent. Queued messages deliver in the background; failed messages need review.</p>
    <button type="button" onClick={refresh} disabled={busy}>{busy ? 'Loading…' : 'Refresh email status'}</button>
    {message && <p role="status">{message}</p>}
    {previews.map(item => <details key={item.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid #ddd' }}>
      <summary>{item.status}: {item.payload.subject} — {item.payload.to}</summary>
      <p>Created: {new Date(item.created_at).toLocaleString()}</p>
      {item.status === 'failed' && <button type="button" disabled={busy} onClick={() => retry(item.id)}>Retry delivery</button>}
      {item.payload.text ? <pre style={{ whiteSpace: 'pre-wrap' }}>{item.payload.text}</pre>
        : <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.payload.html || '', { FORBID_TAGS: ['img', 'iframe', 'style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] }) }} />}
    </details>)}
  </section>
}
