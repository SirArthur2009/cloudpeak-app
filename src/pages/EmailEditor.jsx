import { useId, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { renderCampaignMarkdown } from '../../supabase/functions/_shared/campaignMarkdown'
import './EmailEditor.css'

export default function EmailEditor({ value, onChange, inputRef, label = 'Message', rows = 8, subject = '' }) {
  const generatedId = useId()
  const localRef = useRef(null)
  const editorRef = inputRef || localRef
  const linkSelection = useRef({ start: 0, end: 0 })
  const [mode, setMode] = useState('write')
  const [color, setColor] = useState('#1769c2')
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkError, setLinkError] = useState('')

  function replaceSelection(before, after = '', placeholder = 'text') {
    const editor = editorRef.current
    if (!editor) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = value.slice(start, end) || placeholder
    onChange(value.slice(0, start) + before + selected + after + value.slice(end))
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(start + before.length, start + before.length + selected.length) })
  }

  function insertLine(prefix, placeholder) {
    const editor = editorRef.current
    if (!editor) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const selected = value.slice(lineStart, end) || placeholder
    const replacement = selected.split('\n').map(line => `${prefix}${line}`).join('\n')
    onChange(value.slice(0, lineStart) + replacement + value.slice(end))
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(lineStart + prefix.length, lineStart + replacement.length) })
  }

  function addLink() {
    let url
    try { url = new URL(linkUrl.trim()) } catch { setLinkError('Enter a valid URL.'); return }
    if (!['https:', 'http:'].includes(url.protocol)) { setLinkError('Use an http or https link.'); return }
    const editor = editorRef.current
    const { start, end } = linkSelection.current
    const text = linkLabel.trim() || value.slice(start, end) || 'Link text'
    const insertion = `[${text}](${url.href})`
    onChange(value.slice(0, start) + insertion + value.slice(end))
    setLinkOpen(false); setLinkUrl(''); setLinkLabel(''); setLinkError('')
    setMode('write')
    requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + insertion.length, start + insertion.length) })
  }

  return <div className="email-editor">
    <div className="email-editor__header">
      <label htmlFor={generatedId}>{label}</label>
      <div className="email-editor__tabs" aria-label={`${label} view`}>
        <button type="button" className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')}>Write</button>
        <button type="button" className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button>
      </div>
    </div>
    {mode === 'write' ? <>
      <div className="email-editor__toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <button type="button" title="Bold" aria-label="Bold" onClick={() => replaceSelection('**', '**', 'bold text')}><strong>B</strong></button>
        <button type="button" title="Italic" aria-label="Italic" onClick={() => replaceSelection('*', '*', 'italic text')}><em>I</em></button>
        <span className="email-editor__divider" aria-hidden="true" />
        <button type="button" title="Heading" onClick={() => insertLine('## ', 'Heading')}>Heading</button>
        <button type="button" title="Bullet list" onClick={() => insertLine('- ', 'List item')}>☷ List</button>
        <span className="email-editor__divider" aria-hidden="true" />
        <button type="button" title="Insert link" onClick={() => { const editor = editorRef.current; linkSelection.current = { start: editor?.selectionStart ?? value.length, end: editor?.selectionEnd ?? value.length }; setLinkLabel(value.slice(linkSelection.current.start, linkSelection.current.end)); setLinkOpen(true); setLinkError('') }}>↗ Link</button>
        <label className="email-editor__color" title="Text color">Color <input type="color" aria-label="Text color" value={color} onChange={event => setColor(event.target.value)} /></label>
        <button type="button" title="Apply selected color" onClick={() => replaceSelection(`{color:${color}|`, '}', 'colored text')}>Apply color</button>
      </div>
      {linkOpen && <div className="email-editor__link">
        <input aria-label="Link text" placeholder="Link text" value={linkLabel} onChange={event => setLinkLabel(event.target.value)} />
        <input aria-label="Link URL" type="url" placeholder="https://example.com" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addLink() } }} />
        <button type="button" onClick={addLink}>Insert link</button>
        <button type="button" onClick={() => setLinkOpen(false)}>Cancel</button>
        {linkError && <span role="alert">{linkError}</span>}
      </div>}
      <textarea id={generatedId} ref={editorRef} rows={rows} value={value} onChange={event => onChange(event.target.value)} maxLength={20000} placeholder="Write your message…" />
      <div className="email-editor__footer"><span>Formatting is shown in Preview</span><span>{value.length.toLocaleString()} / 20,000</span></div>
    </> : <div className="email-editor__preview" aria-label={`${label} preview`}>{subject && <div className="email-editor__subject">{subject}</div>}{value.trim() ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderCampaignMarkdown(value)) }} /> : <p>Your message preview will appear here.</p>}</div>}
  </div>
}
