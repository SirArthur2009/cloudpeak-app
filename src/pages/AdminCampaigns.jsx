import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabase'
import { renderCampaignMarkdown } from '../../supabase/functions/_shared/campaignMarkdown'

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
  const [sender, setSender] = useState('admin')
  const [customRecipients, setCustomRecipients] = useState('')
  const [count, setCount] = useState(0)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [textColor, setTextColor] = useState('#1769c2')
  const messageRef = useRef(null)

  function insertFormatting(before, after = before, placeholder = 'text') {
    const editor = messageRef.current
    if (!editor) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = body.slice(start, end) || placeholder
    setBody(body.slice(0, start) + before + selected + after + body.slice(end))
    requestAnimationFrame(() => {
      editor.focus()
      editor.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  function insertLink() {
    const editor = messageRef.current
    if (!editor) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = body.slice(start, end)
    const url = window.prompt('Link URL (https://...)')
    if (!url) return
    let parsed
    try { parsed = new URL(url) } catch { setMessage('Enter a valid link URL.'); return }
    if (!['https:', 'http:'].includes(parsed.protocol)) { setMessage('Links must start with https:// or http://.'); return }
    const label = selected || window.prompt('Link text', 'Click here') || 'Click here'
    setBody(body.slice(0, start) + `[${label}](${parsed.href})` + body.slice(end))
    requestAnimationFrame(() => editor.focus())
  }

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
      body: { audience, sender, recipients: audience === 'custom' ? [...new Set(recipients)] : undefined, subject: subject.trim(), message: body.trim() }
    })
    setBusy(false)
    setMessage(error?.message || data?.error || `Sent ${data?.sent || 0} of ${data?.total || count} emails.${data?.failed ? ` ${data.failed} failed.` : ''}`)
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
    <label>From<select style={field} value={sender} onChange={e => setSender(e.target.value)}><option value="admin">Admin</option><option value="levi">Levi</option><option value="leah">Leah</option><option value="owner">Owner</option><option value="noreply">No reply</option></select></label>
    <label>Saved template<select style={field} value={selectedTemplate} onChange={e => {
      const id = e.target.value; setSelectedTemplate(id)
      const template = templates.find(t => t.id === id)
      setTemplateName(template?.name || ''); if (template) { setSubject(template.subject); setBody(template.body) }
    }}><option value="">New message</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Template name<input style={field} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Litter update" /></label>
    <label>Subject<input style={field} value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} /></label>
    <label htmlFor="campaign-message">Message</label>
    <div role="toolbar" aria-label="Message formatting" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
      <button type="button" style={button} onClick={() => insertFormatting('**', '**', 'bold text')}>Bold</button>
      <button type="button" style={button} onClick={() => insertFormatting('*', '*', 'italic text')}>Italic</button>
      <button type="button" style={button} onClick={() => insertFormatting('## ', '', 'Heading')}>Heading</button>
      <button type="button" style={button} onClick={() => insertFormatting('- ', '', 'List item')}>Bullet list</button>
      <button type="button" style={button} onClick={insertLink}>Link</button>
      <label style={{ ...button, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Text color
        <input type="color" aria-label="Choose text color" value={textColor} onChange={e => setTextColor(e.target.value)} style={{ width: 30, height: 26, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }} />
      </label>
      <button type="button" style={button} onClick={() => insertFormatting(`{color:${textColor}|`, '}', 'colored text')}>Apply color</button>
    </div>
    <textarea id="campaign-message" ref={messageRef} style={{ ...field, minHeight: 220 }} value={body} onChange={e => setBody(e.target.value)} maxLength={20000} placeholder="Write your email here. Use the toolbar to add formatting." />
    <h4 style={{ margin: '18px 0 8px' }}>Email preview</h4>
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '16px 20px', background: '#fff', overflowWrap: 'anywhere' }}>
      <div style={{ fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 10, marginBottom: 14 }}>{subject || 'Subject'}</div>
      {body.trim() ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderCampaignMarkdown(body)) }} /> : <p style={{ color: '#888' }}>Your message preview will appear here.</p>}
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      <button style={button} disabled={busy} onClick={saveTemplate}>Save template</button>
      {selectedTemplate && <button style={button} disabled={busy} onClick={deleteTemplate}>Delete template</button>}
      <button style={{ ...button, background: '#1a1a1a', color: '#fff' }} disabled={busy || !count} onClick={send}>Send email</button>
    </div>
  </section>
}
