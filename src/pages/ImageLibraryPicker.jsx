import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import './ImageLibraryPicker.css'

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
      const privateImages = images.filter(file => !file.storage_bucket || file.storage_bucket === 'admin-files')
      const signed = []
      let signError = null
      for (let index = 0; index < privateImages.length; index += 100) {
        const result = await supabase.storage.from('admin-files').createSignedUrls(privateImages.slice(index, index + 100).map(file => file.storage_path), 600)
        if (result.error) { signError = result.error; break }
        signed.push(...result.data)
      }
      if (active) {
        if (signError) setError(signError.message)
        const privateUrls = new Map(privateImages.map((file, index) => [file.id, signed[index]?.signedUrl]))
        setItems(images.map(file => ({ ...file, previewUrl: file.storage_bucket && file.storage_bucket !== 'admin-files'
          ? supabase.storage.from(file.storage_bucket).getPublicUrl(file.storage_path).data.publicUrl
          : privateUrls.get(file.id) })))
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
    ignoreClick.current = true
    if (event.ctrlKey || event.metaKey) {
      const id = visible[index].id
      setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
      return
    }
    dragAnchor.current = index
    setSelectedIds([visible[index].id])
  }
  function extendSelection(event, index) {
    if (!multiple || dragAnchor.current === null || event.buttons !== 1) return
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
      <div className="image-library-summary"><span>{visible.length} images</span>{multiple && <span>Drag across cards, Ctrl-click, or tap to select.</span>}</div>
      {error && <p className="image-library-error" role="alert">{error}</p>}
      {loading ? <p className="image-library-empty">Loading images…</p> : visible.length === 0 ? <p className="image-library-empty">No images found. Upload an image in Files first.</p> :
        <div className="image-library-grid">{visible.map((file, index) => <button type="button" className={selectedIds.includes(file.id) ? 'selected' : ''} key={file.id} onPointerDown={event => startSelection(event, index)} onPointerEnter={event => extendSelection(event, index)} onClick={() => clickItem(file)} disabled={busy} title={file.name} aria-pressed={multiple ? selectedIds.includes(file.id) : undefined}>
          {file.previewUrl ? <img src={file.previewUrl} alt="" loading="lazy" draggable="false" /> : <span className="image-library-placeholder">Image</span>}
          <span className="image-library-card-caption">{multiple && <span className="image-library-check" aria-hidden="true">{selectedIds.includes(file.id) ? '✓' : ''}</span>} <strong>{file.name}</strong><small>{folderPath(file.folder_id)}</small></span>
        </button>)}</div>}
      {multiple && <div className="image-library-footer"><span>{selectedIds.length} selected · Drag across photos or tap to select</span><button type="button" disabled={busy || !selectedIds.length} onClick={() => choose(items.filter(file => selectedIds.includes(file.id)))}>Add selected photos</button></div>}
      {busy && <p className="image-library-working" role="status">Adding image…</p>}
    </div>
  </div>
}
