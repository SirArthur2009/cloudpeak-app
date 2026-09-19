import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const field = { width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, font: 'inherit' }
const button = { padding: '0.6rem 0.9rem', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' }

export default function AdminCampaigns() {
  const [litters, setLitters] = useState([])
  const [templates, setTemplates] = useState([])
  const [audience, setAudience] = useState('all')
  const [count, setCount] = useState(0)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const [l, t] = await Promise.all([
      supabase.from('litters').select('id, name').order('created_at', { ascending: false }),
      supabase.from('email_templates').select('*').order('name')
    ])
    if (l.error || t.error) { setMessage(l.error?.message || t.error?.message); return }
    setLitters(l.data || []); setTemplates(t.data || [])
  }
  useEffect(() => {
    Promise.all([
      supabase.from('litters').select('id, name').order('created_at', { ascending: false }),
      supabase.from('email_templates').select('*').order('name')
    ]).then(([l, t]) => {
      if (l.error || t.error) { setMessage(l.error?.message || t.error?.message); return }
      setLitters(l.data || []); setTemplates(t.data || [])
    })
  }, [])
  useEffect(() => {
    let active = true
    supabase.from('waitlist').select('email, litter_id').then(({ data, error }) => {
      if (!active) return
      if (error) { setMessage(error.message); return }
      setCount(new Set((data || []).filter(row => audience === 'all' || String(row.litter_id) === audience).map(row => row.email?.trim().toLowerCase()).filter(Boolean)).size)
    })
    return () => { active = false }
  }, [audience])

  async function saveTemplate() {
    if (!templateName.trim() || !subject.trim() || !body.trim()) { setMessage('Template name, subject, and message are required.'); return }
    setBusy(true); setMessage('')
    const payload = { name: templateName.trim(), subject: subject.trim(), body: body.trim(), updated_at: new Date().toISOString() }
    const result = selectedTemplate
      ? await supabase.from('email_templates').update(payload).eq('id', selectedTemplate)
      : await supabase.from('email_templates').insert(payload)
    setBusy(false)
    if (result.error) setMessage(result.error.message)
    else { setMessage('Template saved.'); await load() }
  }
  async function deleteTemplate() {
    if (!selectedTemplate || !confirm(`Delete template ${templateName}?`)) return
    setBusy(true)
    const { error } = await supabase.from('email_templates').delete().eq('id', selectedTemplate)
    setBusy(false)
    if (error) setMessage(error.message)
    else { setSelectedTemplate(''); setTemplateName(''); setMessage('Template deleted.'); await load() }
  }
  async function send() {
    if (!subject.trim() || !body.trim()) { setMessage('Subject and message are required.'); return }
    if (!count) { setMessage('No recipients on this waitlist.'); return }
    if (!confirm(`Send this email to approximately ${count} unique waitlist addresses?`)) return
    setBusy(true); setMessage('Sending...')
    const { data, error } = await supabase.functions.invoke('send-waitlist-campaign', {
      body: { litter_id: audience === 'all' ? null : audience, subject: subject.trim(), message: body.trim() }
    })
    setBusy(false)
    setMessage(error?.message || data?.error || `Sent ${data?.sent || 0} of ${data?.total || count} emails.${data?.failed ? ` ${data.failed} failed.` : ''}`)
  }
  return <section style={{ maxWidth: 760 }}>
    <h3>Email waitlist</h3>
    <p style={{ color: '#666' }}>Each address receives its own email. Duplicate addresses are sent once.</p>
    {message && <p role="status">{message}</p>}
    <label>Recipients<select style={field} value={audience} onChange={e => setAudience(e.target.value)}>
      <option value="all">Everyone on a waitlist</option>
      {litters.map(l => <option key={l.id} value={l.id}>{l.name} waitlist</option>)}
    </select></label>
    <p>{count} unique email {count === 1 ? 'address' : 'addresses'}</p>
    <label>Saved template<select style={field} value={selectedTemplate} onChange={e => {
      const id = e.target.value; setSelectedTemplate(id)
      const template = templates.find(t => t.id === id)
      setTemplateName(template?.name || ''); if (template) { setSubject(template.subject); setBody(template.body) }
    }}><option value="">New message</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Template name<input style={field} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Litter update" /></label>
    <label>Subject<input style={field} value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} /></label>
    <label>Message<textarea style={{ ...field, minHeight: 220 }} value={body} onChange={e => setBody(e.target.value)} maxLength={20000} /></label>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      <button style={button} disabled={busy} onClick={saveTemplate}>Save template</button>
      {selectedTemplate && <button style={button} disabled={busy} onClick={deleteTemplate}>Delete template</button>}
      <button style={{ ...button, background: '#1a1a1a', color: '#fff' }} disabled={busy || !count} onClick={send}>Send email</button>
    </div>
  </section>
}
