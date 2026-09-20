import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { browserPreviewBlob, isHeicFile } from '../lib/explorerImages'
import { sizedImageUrl, originalOnError } from '../lib/imageLoading'
import './ImageLibraryPicker.css'

function PickerThumbnail({ file }) {
  const tileRef = useRef(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [preview, setPreview] = useState({ url: '', error: '' })
  useEffect(() => {
    if (!tileRef.current) return
    if (!('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '400px' })
    observer.observe(tileRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let active = true
    let objectUrl = ''
    async function load() {
      try {
        const bucket = file.storage_bucket || 'admin-files'
        if (isHeicFile(file)) {
          const { data, error } = await supabase.storage.from(bucket).download(file.storage_path)
          if (error) throw error
          objectUrl = URL.createObjectURL(await browserPreviewBlob(data, file))
          if (active) setPreview({ url: objectUrl, error: '' })
        } else if (bucket !== 'admin-files') {
          const url = supabase.storage.from(bucket).getPublicUrl(file.storage_path).data.publicUrl
          if (active) setPreview({ url, error: '' })
        } else {
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(file.storage_path, 3600, { transform: { width: 320, quality: 75 } })
          if (error) throw error
          if (active) setPreview({ url: data.signedUrl, error: '' })
        }
      } catch (error) { if (active) setPreview({ url: '', error: error.message }) }
    }
    load()
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [visible, file])
  return <span ref={tileRef} className="image-library-photo">
    {preview.url ? <img src={file.storage_bucket && file.storage_bucket !== 'admin-files' ? sizedImageUrl(preview.url, 320) : preview.url} alt="" loading="lazy" decoding="async" draggable="false" onError={event => {
      if (file.storage_bucket && file.storage_bucket !== 'admin-files') { originalOnError(event, preview.url); return }
      if (event.currentTarget.dataset.fallback) { setPreview({ url: '', error: 'Preview unavailable' }); return }
      event.currentTarget.dataset.fallback = 'true'
      supabase.storage.from('admin-files').createSignedUrl(file.storage_path, 3600).then(({ data }) => {
        if (data?.signedUrl && event.target?.isConnected) event.target.src = data.signedUrl
      })
    }} /> : <span className="image-library-placeholder" title={preview.error}><span aria-hidden="true">▧</span><small>{preview.error || (visible ? 'Loading photo…' : 'Photo')}</small></span>}
  </span>
}

export default function ImageLibraryPicker({ onChoose, onClose, multiple = false }) {
  const [items, setItems] = useState([])
  const [folders, setFolders] = useState([])
  const [query, setQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const dragAnchor = useRef(null)
  const ignoreClick = useRef(null)

  useEffect(() => {
    const endDrag = () => { dragAnchor.current = null; setTimeout(() => { ignoreClick.current = null }, 0) }
    window.addEventListener('pointerup', endDrag)
    return () => window.removeEventListener('pointerup', endDrag)
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      const { data: folderData, error: folderError } = await supabase.from('admin_folders').select('id, parent_id, name').order('name')
      if (folderError) { if (active) { setError(folderError.message); setLoading(false) } return }
      if (active) setFolders(folderData || [])
      const all = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: loadError } = await supabase.from('admin_files').select('id, name, folder_id, content_type, storage_path, storage_bucket').order('name').order('id').range(offset, offset + 499)
        if (loadError) { if (active) { setError(loadError.message); setLoading(false) } return }
        all.push(...(data || []))
        if (!data || data.length < 500) break
      }
      const images = all.filter(file => file.content_type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name))
      if (active) {
        setItems(images)
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  async function choose(file) {
    setBusy(true); setError('')
    try { await onChoose(file); onClose() }
    catch (chooseError) { setError(chooseError.message); setBusy(false) }
  }

  const folderMap = new Map(folders.map(folder => [folder.id, folder]))
  function folderPath(id) {
    const parts = []
    const seen = new Set()
    while (id && folderMap.has(id) && !seen.has(id)) {
      seen.add(id)
      const folder = folderMap.get(id)
      parts.unshift(folder.name)
      id = folder.parent_id
    }
    return parts.join(' / ') || 'Files'
  }
  const visible = items.filter(file => (folderFilter === 'all' || folderFilter === 'root' && file.folder_id === null || file.folder_id === folderFilter) && `${file.name} ${folderPath(file.folder_id)}`.toLowerCase().includes(query.toLowerCase()))
  function startSelection(event, index) {
    if (!multiple || event.pointerType === 'touch') return
    ignoreClick.current = null
    dragAnchor.current = index
  }
  function extendSelection(event, index) {
    if (!multiple || dragAnchor.current === null || event.buttons !== 1) return
    if (dragAnchor.current === index) return
    ignoreClick.current = true
    setSelectedIds(visible.slice(Math.min(dragAnchor.current, index), Math.max(dragAnchor.current, index) + 1).map(file => file.id))
  }
  function clickItem(file) {
    if (!multiple) { choose(file); return }
    if (ignoreClick.current) { ignoreClick.current = null; return }
    setSelectedIds(ids => ids.includes(file.id) ? ids.filter(id => id !== file.id) : [...ids, file.id])
  }
  return <div className="image-library-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="image-library-dialog" role="dialog" aria-modal="true" aria-label="Choose image from files">
      <div className="image-library-header"><div><h3>Choose from Files</h3><p>Selected images become available to the public site and stay in Files.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close image library">×</button></div>
      <div className="image-library-controls"><label><span>SEARCH</span><input className="image-library-search" type="search" placeholder="Find an image" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search images" /></label><label><span>LOCATION</span><select value={folderFilter} onChange={event => setFolderFilter(event.target.value)} aria-label="Filter by folder"><option value="all">All folders</option><option value="root">Files (top level)</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</select></label></div>
      <div className="image-library-summary"><span>{visible.length} images</span>{multiple && <span className="image-library-selection-actions"><button type="button" onClick={() => setSelectedIds(ids => [...new Set([...ids, ...visible.map(file => file.id)])])}>Select all shown</button><button type="button" onClick={() => setSelectedIds([])}>Clear selection</button></span>}</div>
      {error && <p className="image-library-error" role="alert">{error}</p>}
      {loading ? <p className="image-library-empty">Loading images…</p> : visible.length === 0 ? <p className="image-library-empty">No images found. Upload an image in Files first.</p> :
        <div className="image-library-grid">{visible.map((file, index) => <button type="button" className={selectedIds.includes(file.id) ? 'selected' : ''} key={file.id} onPointerDown={event => startSelection(event, index)} onPointerEnter={event => extendSelection(event, index)} onClick={() => clickItem(file)} disabled={busy} title={file.name} aria-pressed={multiple ? selectedIds.includes(file.id) : undefined}>
          <PickerThumbnail file={file} />
          {multiple && <span className="image-library-check" aria-hidden="true">{selectedIds.includes(file.id) ? '✓' : ''}</span>}
          <span className="image-library-card-caption"><strong>{file.name}</strong></span>
        </button>)}</div>}
      {multiple && <div className="image-library-footer"><span>{selectedIds.length} selected · Drag across photos or tap to select</span><button type="button" disabled={busy || !selectedIds.length} onClick={() => choose(items.filter(file => selectedIds.includes(file.id)))}>Add selected photos</button></div>}
      {busy && <p className="image-library-working" role="status">Adding image…</p>}
    </div>
  </div>
}
