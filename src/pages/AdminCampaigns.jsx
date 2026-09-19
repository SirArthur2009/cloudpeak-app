import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import EmailEditor from './EmailEditor'

const field = { width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, font: 'inherit' }
const button = { padding: '0.6rem 0.9rem', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' }
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const litterGroup = status => status === 'available' || status === 'limited' ? 0 : status === 'upcoming' ? 1 : 2

async function loadAddresses(table, litterId) {
  const addresses = new Set()
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from(table).select('email').order('id').range(offset, offset + 999)
    if (litterId) query = query.eq('litter_id', litterId)
    const { data, error } = await query
    if (error) throw error
    for (const row of data || []) {
      const email = String(row.email || '').trim().toLowerCase()
      if (validEmail(email)) addresses.add(email)
    }
    if ((data || []).length < 1000) break
  }
  return addresses
}

export default function AdminCampaigns({ initialLitterId = null }) {
  const [litters, setLitters] = useState([])
  const [templates, setTemplates] = useState([])
  const [audience, setAudience] = useState(initialLitterId ? `litter:${initialLitterId}` : 'waitlists')
  const [sender, setSender] = useState('levi')
  const [customSenderName, setCustomSenderName] = useState('')
  const [customSenderEmail, setCustomSenderEmail] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [customRecipients, setCustomRecipients] = useState('')
  const [count, setCount] = useState(0)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const messageRef = useRef(null)

  async function load() {
    const [l, t] = await Promise.all([
      supabase.from('litters').select('id, name, status').order('created_at', { ascending: false }),
      supabase.from('email_templates').select('*').order('name')
    ])
    if (l.error || t.error) { setMessage(l.error?.message || t.error?.message); return }
    setLitters(l.data || []); setTemplates(t.data || [])
  }
  useEffect(() => {
    Promise.all([
      supabase.from('litters').select('id, name, status').order('created_at', { ascending: false }),
      supabase.from('email_templates').select('*').order('name')
    ]).then(([l, t]) => {
      if (l.error || t.error) { setMessage(l.error?.message || t.error?.message); return }
      setLitters(l.data || []); setTemplates(t.data || [])
    })
  }, [])
  useEffect(() => {
    let active = true
    setCount(0)
    if (audience === 'custom') {
      const addresses = customRecipients.split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(validEmail)
      setCount(new Set(addresses).size)
      return
    }
    Promise.all([
      audience === 'applicants' || audience === 'everyone' ? loadAddresses('applications') : Promise.resolve(new Set()),
      audience !== 'applicants' ? loadAddresses('waitlist', audience.startsWith('litter:') ? audience.slice(7) : null) : Promise.resolve(new Set())
    ]).then(([applicants, waitlist]) => {
      if (active) setCount(new Set([...applicants, ...waitlist]).size)
    }).catch(error => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [audience, customRecipients])

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
    const recipients = customRecipients.split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean)
    if (audience === 'custom' && recipients.some(email => !validEmail(email))) { setMessage('Fix the invalid email addresses before sending.'); return }
    if (!count) { setMessage('No recipients in this audience.'); return }
    if (!confirm(`Send this email to approximately ${count} unique addresses?`)) return
    setBusy(true); setMessage('Sending...')
    const { data, error } = await supabase.functions.invoke('send-waitlist-campaign', {
      body: { audience, sender, custom_sender_name: customSenderName.trim(), custom_sender_email: customSenderEmail.trim(), reply_to: replyTo.trim() || undefined, recipients: audience === 'custom' ? [...new Set(recipients)] : undefined, subject: subject.trim(), message: body.trim() }
    })
    setBusy(false)
    let detail = data?.error || data?.errors?.[0]
    if (error?.context?.json) {
      const response = await error.context.json().catch(() => null)
      detail = response?.error || response?.errors?.[0] || detail
    }
    setMessage(detail || error?.message || `Sent ${data?.sent || 0} of ${data?.total || count} emails.${data?.failed ? ` ${data.failed} failed.` : ''}`)
  }
  return <section style={{ maxWidth: 760 }}>
    <h3>Email campaigns</h3>
    <p style={{ color: '#666' }}>Each address receives its own email. Duplicate addresses are sent once.</p>
    {message && <p role="status">{message}</p>}
    <label>Recipients<select style={field} value={audience} onChange={e => setAudience(e.target.value)}>
      <option value="waitlists">Everyone on a waitlist</option>
      {['Available', 'Upcoming', 'Past'].map((group, index) => <optgroup key={group} label={`${group} litters`}>
        {litters.filter(l => litterGroup(l.status) === index).map(l => <option key={l.id} value={`litter:${l.id}`}>{l.name} waitlist{l.status === 'placed' ? ' (fully placed)' : ''}</option>)}
      </optgroup>)}
      <option value="everyone">Everyone (waitlists and applicants)</option>
      <option value="applicants">Everyone who applied</option>
      <option value="custom">Specific email addresses</option>
    </select></label>
    {audience === 'custom' && <label>Email addresses<textarea style={{ ...field, minHeight: 90 }} value={customRecipients} onChange={e => setCustomRecipients(e.target.value)} placeholder="One address per line, or separate with commas" />
      <span style={{ color: '#666' }}>Each address receives a separate email. Duplicate addresses are sent once.</span>
    </label>}
    <p>{count} unique email {count === 1 ? 'address' : 'addresses'}</p>
    <label>From<select style={field} value={sender} onChange={e => setSender(e.target.value)}><option value="levi">Levi</option><option value="leah">Leah</option><option value="noreply">No reply</option><option value="custom">Custom</option></select></label>
    {sender === 'custom' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><label style={{ flex: '1 1 180px' }}>Sender name<input style={field} value={customSenderName} onChange={e => setCustomSenderName(e.target.value)} placeholder="Name shown to recipients" /></label><label style={{ flex: '2 1 260px' }}>Sender email<input type="email" style={field} value={customSenderEmail} onChange={e => setCustomSenderEmail(e.target.value)} placeholder="hello@cloudpeaksilverlabradors.com" /></label></div>}
    <label>Reply-to email (optional)<input type="email" style={field} value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="Where replies should go" /></label>
    <label>Saved template<select style={field} value={selectedTemplate} onChange={e => {
      const id = e.target.value; setSelectedTemplate(id)
      const template = templates.find(t => t.id === id)
      setTemplateName(template?.name || ''); if (template) { setSubject(template.subject); setBody(template.body) }
    }}><option value="">New message</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Template name<input style={field} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Litter update" /></label>
    <label>Subject<input style={field} value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} /></label>
    <EmailEditor value={body} onChange={setBody} inputRef={messageRef} rows={10} subject={subject} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      <button style={button} disabled={busy} onClick={saveTemplate}>Save template</button>
      {selectedTemplate && <button style={button} disabled={busy} onClick={deleteTemplate}>Delete template</button>}
      <button style={{ ...button, background: '#1a1a1a', color: '#fff' }} disabled={busy || !count} onClick={send}>Send email</button>
    </div>
  </section>
}
