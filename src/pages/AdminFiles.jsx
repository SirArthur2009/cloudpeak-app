import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import * as tus from 'tus-js-client'
import { prepareExplorerFile } from '../lib/explorerImages'
import './AdminFiles.css'

const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`
const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fileKind = file => file.content_type?.startsWith('image/') ? 'Image' : file.content_type === 'application/pdf' ? 'PDF document' : file.name.includes('.') ? `${file.name.split('.').pop().toUpperCase()} file` : 'File'
const extensionOf = name => { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot) : '' }
const isImage = file => file.content_type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name)

function FileGlyph({ folder = false, image = false }) {
  return <span className={`file-icon${folder ? ' folder-icon' : image ? ' image-icon' : ''}`} aria-hidden="true">
    {folder ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M3 6.5h6l2 2H21v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z"/><path d="M3 10.5h18"/></svg>
      : image ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M6 2.5h8l4 4V21H6a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2Z"/><path d="M14 2.5v5h5M8 12h8M8 16h8"/></svg>}
  </span>
}

export default function AdminFiles({ onOpenCleanup }) {
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [folderId, setFolderId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null)
  const [preview, setPreview] = useState(null)
  const previewRequest = useRef(0)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkName, setBulkName] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const dragAnchor = useRef(null)

  useEffect(() => {
    const stopDrag = () => { dragAnchor.current = null }
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    return () => { window.removeEventListener('pointerup', stopDrag); window.removeEventListener('pointercancel', stopDrag) }
  }, [])

  useEffect(() => {
    if (!preview) return
    const onKeyDown = event => { if (event.key === 'Escape') { previewRequest.current++; setPreview(null) } }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (preview.url) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  async function refresh() {
    const [folderResult, fileResult] = await Promise.all([
      supabase.from('admin_folders').select('*').order('name'),
      supabase.from('admin_files').select('*').order('name')
    ])
    if (folderResult.error || fileResult.error) { setMessage(folderResult.error?.message || fileResult.error?.message); return }
    setFolders(folderResult.data || [])
    setFiles(fileResult.data || [])
  }
  useEffect(() => {
    Promise.all([
      supabase.from('admin_folders').select('*').order('name'),
      supabase.from('admin_files').select('*').order('name')
    ]).then(([folderResult, fileResult]) => {
      if (folderResult.error || fileResult.error) { setMessage(folderResult.error?.message || fileResult.error?.message); return }
      setFolders(folderResult.data || []); setFiles(fileResult.data || [])
    })
  }, [])

  const children = folders.filter(f => f.parent_id === folderId)
  const currentFiles = files.filter(f => f.folder_id === folderId)
  const visibleFiles = currentFiles.filter(file => file.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === 'images' && isImage(file) || filter === 'other' && !isImage(file) || filter === 'public' && file.storage_bucket && file.storage_bucket !== 'admin-files'))
  const visibleFolders = filter === 'all' ? children.filter(folder => folder.name.toLowerCase().includes(search.toLowerCase())) : []
  const selectedFiles = visibleFiles.filter(f => selectedIds.includes(f.id))
  const current = folders.find(f => f.id === folderId)
  const crumbs = []
  let ancestor = current
  while (ancestor && crumbs.length < folders.length) {
    crumbs.unshift(ancestor)
    ancestor = folders.find(f => f.id === ancestor.parent_id)
  }
  const folderNav = []
  const visitedFolders = new Set()
  function collectFolders(parentId, depth) {
    for (const folder of folders.filter(item => item.parent_id === parentId)) {
      if (visitedFolders.has(folder.id)) continue
      visitedFolders.add(folder.id)
      folderNav.push({ ...folder, depth })
      collectFolders(folder.id, depth + 1)
    }
  }
  collectFolders(null, 0)

  function goToFolder(id) {
    setFolderId(id); setSelectedIds([]); setSearch(''); setFilter('all'); setEditing(null)
  }

  async function run(action) {
    setBusy(true); setMessage('')
    try { await action(); await refresh() } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  async function createFolder(event) {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name) { setMessage('Enter a folder name.'); return }
    if (folders.some(folder => folder.parent_id === folderId && folder.name.toLowerCase() === name.toLowerCase())) { setMessage('A folder with that name already exists here.'); return }
    await run(async () => {
      const { error } = await supabase.from('admin_folders').insert({ name, parent_id: folderId })
      if (error) throw error
      setCreatingFolder(false); setNewFolderName('')
    })
  }
  async function upload(event, includeFolders = false) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selected.length) {
      if (includeFolders) setMessage('The selected folder has no files to upload.')
      return
    }
    const entries = selected.map(file => ({ file, folders: includeFolders ? file.webkitRelativePath.split('/').slice(0, -1) : [] }))
    if (includeFolders && entries.some(entry => !entry.folders.length || entry.folders.some(name => !name.trim() || name.length > 150))) {
      setMessage('This folder has an invalid folder name, or your browser does not support folder uploads.')
      return
    }
    const totalBytes = selected.reduce((sum, file) => sum + file.size, 0)
    let completedBytes = 0
    const folderCache = new Map(folders.map(folder => [JSON.stringify([folder.parent_id, folder.name]), folder.id]))
    async function ensureFolder(parentId, name) {
      const key = JSON.stringify([parentId, name])
      if (folderCache.has(key)) return folderCache.get(key)
      const { data, error } = await supabase.from('admin_folders').insert({ parent_id: parentId, name }).select('id').single()
      if (error) throw error
      folderCache.set(key, data.id)
      return data.id
    }
    setUploadProgress({ name: selected[0].name, current: 1, total: selected.length, percent: 0 })
    await run(async () => {
      const failures = []
      for (const [index, { file, folders: pathParts }] of entries.entries()) {
        const updateProgress = uploaded => setUploadProgress({ name: includeFolders ? file.webkitRelativePath : file.name, current: index + 1, total: selected.length, percent: totalBytes ? Math.min(100, Math.round((completedBytes + uploaded) / totalBytes * 100)) : 100 })
        updateProgress(0)
        let prepared
        try { prepared = await prepareExplorerFile(file) }
        catch (error) { failures.push(`${file.name}: ${error.message}`); completedBytes += file.size; continue }
        if (prepared.size > 50 * 1024 * 1024) { failures.push(`${file.name}: exceeds 50 MB after conversion`); completedBytes += file.size; continue }
        let targetFolderId = folderId
        try {
          for (const name of pathParts) targetFolderId = await ensureFolder(targetFolderId, name)
        } catch (error) { failures.push(`${file.name}: ${error.message}`); completedBytes += file.size; continue }
        const path = crypto.randomUUID()
        let uploadError = null
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session) throw new Error('Please sign in again before uploading.')
        try {
          await new Promise((resolve, reject) => {
            new tus.Upload(prepared, {
              endpoint: `${import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`,
              headers: { authorization: `Bearer ${session.access_token}` },
              metadata: { bucketName: 'admin-files', objectName: path, contentType: prepared.type || 'application/octet-stream' },
              chunkSize: 6 * 1024 * 1024, retryDelays: [0, 3000, 5000, 10000], removeFingerprintOnSuccess: true,
              onProgress: uploaded => updateProgress(prepared.size ? file.size * uploaded / prepared.size : file.size),
              onError: reject, onSuccess: resolve
            }).start()
          })
        } catch (error) { uploadError = error }
        completedBytes += file.size
        if (uploadError) { failures.push(`${file.name}: ${uploadError.message}`); continue }
        const { error: saveError } = await supabase.from('admin_files').insert({ folder_id: targetFolderId, name: prepared.name, storage_path: path, size_bytes: prepared.size, content_type: prepared.type || null })
        if (saveError) {
          await supabase.storage.from('admin-files').remove([path])
          failures.push(`${file.name}: ${saveError.message}`)
        }
      }
      if (failures.length) throw new Error(failures.join('; '))
    })
    setUploadProgress(null)
  }
  async function openPreview(file) {
    const request = ++previewRequest.current
    setPreview({ name: file.name, loading: true })
    try {
      const { data, error } = await supabase.storage.from(file.storage_bucket || 'admin-files').download(file.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      if (request !== previewRequest.current) { URL.revokeObjectURL(url); return }
      setPreview({ name: file.name, url })
    } catch (error) {
      if (request === previewRequest.current) { setPreview(null); setMessage(error.message) }
    }
  }
  async function download(file) {
    run(async () => {
      const { data, error } = await supabase.storage.from(file.storage_bucket || 'admin-files').download(file.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    })
  }
  function startRename(type, item) {
    setEditing({ type, id: item.id })
    setDraftName(item.name)
    setMessage('')
  }
  function rename(type, item) {
    const name = draftName.trim()
    if (!name) { setMessage('Enter a name.'); return }
    if (name === item.name) { setEditing(null); return }
    const maxLength = type === 'folder' ? 150 : 255
    if (name.length > maxLength) { setMessage(`Name must be ${maxLength} characters or fewer.`); return }
    if (type === 'folder' && folders.some(f => f.id !== item.id && f.parent_id === item.parent_id && f.name.toLowerCase() === name.toLowerCase())) {
      setMessage('A folder with that name already exists here.'); return
    }
    if (type === 'file' && files.some(f => f.id !== item.id && f.folder_id === item.folder_id && f.name.toLowerCase() === name.toLowerCase())) {
      setMessage('A file with that name already exists here.'); return
    }
    run(async () => {
      const { error } = await supabase.from(type === 'folder' ? 'admin_folders' : 'admin_files').update({ name }).eq('id', item.id)
      if (error) throw error
      setEditing(null)
    })
  }
  function selectRow(event, id) {
    if (busy || event.pointerType === 'touch' || event.target.closest('button, input, label, form')) return
    const index = visibleFiles.findIndex(f => f.id === id)
    if (event.shiftKey && selectedIds.length) {
      const anchorIndex = visibleFiles.findIndex(f => f.id === selectedIds[0])
      if (anchorIndex !== -1) setSelectedIds(visibleFiles.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1).map(f => f.id))
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
    } else {
      setSelectedIds([id])
    }
    dragAnchor.current = index
  }
  function extendSelection(event, id) {
    if (dragAnchor.current === null || event.buttons !== 1) return
    const index = visibleFiles.findIndex(f => f.id === id)
    setSelectedIds(visibleFiles.slice(Math.min(dragAnchor.current, index), Math.max(dragAnchor.current, index) + 1).map(f => f.id))
  }
  async function bulkRename(event) {
    event.preventDefault()
    const base = bulkName.trim()
    if (!base) { setMessage('Enter a name for the selected files.'); return }
    if (/[\\/]/.test(base)) { setMessage('The name cannot contain slashes.'); return }
    const planned = selectedFiles.map((file, index) => ({ file, name: `${base} ${index + 1}${extensionOf(file.name)}` }))
    if (planned.some(({ name }) => name.length > 255)) { setMessage('The name is too long for one or more files.'); return }
    const existing = new Set(currentFiles.filter(file => !selectedIds.includes(file.id)).map(file => file.name.toLowerCase()))
    if (planned.some(({ name }) => existing.has(name.toLowerCase()))) { setMessage('One of the new names is already used in this folder.'); return }
    setBusy(true); setMessage('')
    let completed = 0
    try {
      for (const { file, name } of planned) {
        const { error } = await supabase.from('admin_files').update({ name }).eq('id', file.id)
        if (error) throw error
        completed++
      }
      setSelectedIds([])
      setBulkName('')
      setMessage(`Renamed ${completed} files.`)
    } catch (error) {
      setSelectedIds(planned.slice(completed).map(({ file }) => file.id))
      setMessage(`Renamed ${completed} of ${planned.length} files. ${error.message}`)
    } finally {
      await refresh()
      setBusy(false)
    }
  }
  async function removeFile(file) {
    if (!confirm(`Delete ${file.name}?`)) return
    run(async () => {
      const bucket = file.storage_bucket || 'admin-files'
      if (bucket !== 'admin-files') {
        const url = supabase.storage.from(bucket).getPublicUrl(file.storage_path).data.publicUrl
        const checks = await Promise.all(['puppy_photos', 'puppies', 'dogs'].map(table => supabase.from(table).select('id', { count: 'exact', head: true }).eq('photo_url', url)))
        if (checks.some(check => check.error)) throw checks.find(check => check.error).error
        if (checks.some(check => check.count > 0)) throw new Error('This image is used on the site. Remove those photo references before deleting it.')
      }
      const { error } = await supabase.storage.from(bucket).remove([file.storage_path])
      if (error) throw error
      const result = await supabase.from('admin_files').delete().eq('id', file.id)
      if (result.error) throw result.error
    })
  }
  async function removeFolder(folder) {
    if (folders.some(f => f.parent_id === folder.id) || files.some(f => f.folder_id === folder.id)) { setMessage('Empty the folder before deleting it.'); return }
    if (!confirm(`Delete folder ${folder.name}?`)) return
    run(async () => {
      const { error } = await supabase.from('admin_folders').delete().eq('id', folder.id)
      if (error) throw error
    })
  }
  const renderName = (type, item) => editing?.type === type && editing.id === item.id
    ? <form className="file-rename" onSubmit={event => { event.preventDefault(); rename(type, item) }}>
        <input aria-label={`Rename ${item.name}`} autoFocus value={draftName} maxLength={type === 'folder' ? 150 : 255}
          onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditing(null) }} />
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" onClick={() => setEditing(null)}>Cancel</button>
      </form>
    : type === 'folder'
      ? <button className="file-name-button" onClick={() => goToFolder(item.id)} title={`Open ${item.name}`}>{item.name}</button>
      : <button type="button" className="file-name-button file-rename-trigger" disabled={busy} onClick={() => startRename('file', item)} title={`Rename ${item.name}`} aria-label={`Rename file ${item.name}`}>
          <span className="file-name">{item.name}</span><span className="file-edit-mark" aria-hidden="true">✎</span>
        </button>

  return <section className="file-explorer">
    <div className="file-explorer-heading">
      <div><span className="file-eyebrow">ADMIN LIBRARY</span><h3>Files</h3><p>Organize photos and documents for Cloud Peak.</p></div>
      <div className="file-toolbar">
        <button type="button" className="file-secondary-button" disabled={busy} onClick={() => setCreatingFolder(true)}>+ New folder</button>
        <label className={`file-secondary-button${busy ? ' disabled' : ''}`}>Upload folder<input type="file" webkitdirectory="" directory="" onChange={event => upload(event, true)} disabled={busy} /></label>
        <label className={`file-primary-button${busy ? ' disabled' : ''}`}>Upload files<input type="file" multiple onChange={event => upload(event)} disabled={busy} /></label>
      </div>
    </div>
    <div className="file-workspace">
      <aside className="file-sidebar" aria-label="Folder navigation">
        <div className="file-sidebar-heading">BROWSE <span>{folders.length} folders</span></div>
        <nav className="file-folder-tree" aria-label="Folders">
          <button type="button" className={folderId === null ? 'active' : ''} onClick={() => goToFolder(null)}><span className="file-sidebar-symbol">⌂</span><span>Files home</span><small>{files.filter(file => file.folder_id === null).length}</small></button>
          {folderNav.map(folder => <button type="button" key={folder.id} className={folderId === folder.id ? 'active' : ''} style={{ '--folder-depth': folder.depth }} onClick={() => goToFolder(folder.id)} title={folder.name}><span className="file-sidebar-symbol">▰</span><span>{folder.name}</span><small>{files.filter(file => file.folder_id === folder.id).length}</small></button>)}
        </nav>
        <div className="file-sidebar-note"><strong>Private by default</strong><span>Photos used on the site are marked Public.</span>{onOpenCleanup && <button type="button" onClick={onOpenCleanup}>Review duplicate photos →</button>}</div>
      </aside>
    <div className="file-window">
      {creatingFolder && <form className="file-create-folder" onSubmit={createFolder}>
        <FileGlyph folder /><input autoFocus aria-label="New folder name" placeholder="Folder name" value={newFolderName} maxLength={150} onChange={event => setNewFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setCreatingFolder(false) }} />
        <button type="submit" disabled={busy}>Create</button><button type="button" onClick={() => { setCreatingFolder(false); setNewFolderName('') }}>Cancel</button>
      </form>}
      {uploadProgress && <div className="file-upload-progress" role="status" aria-live="polite">
        <div><strong>Uploading {uploadProgress.current} of {uploadProgress.total}</strong><span>{uploadProgress.percent}%</span></div>
        <p title={uploadProgress.name}>{uploadProgress.name}</p>
        <progress value={uploadProgress.percent} max="100" aria-label="Upload progress" />
      </div>}
      <nav className="file-breadcrumbs" aria-label="Folder path">
        <button onClick={() => goToFolder(null)} aria-current={folderId === null ? 'page' : undefined}>Files</button>
        {crumbs.map(f => <span key={f.id} className="file-crumb"><span aria-hidden="true">›</span><button onClick={() => goToFolder(f.id)} aria-current={folderId === f.id ? 'page' : undefined}>{f.name}</button></span>)}
      </nav>
      <div className="file-location"><div><strong>{current?.name || 'Files home'}</strong><span>{children.length} folders · {currentFiles.length} files</span></div></div>
      <div className="file-controls"><label className="file-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search this folder" placeholder="Search this folder" value={search} onChange={event => { setSearch(event.target.value); setSelectedIds([]) }} /></label><div className="file-filters" role="group" aria-label="Filter files">
        {[['all', 'All'], ['images', 'Images'], ['other', 'Other files'], ['public', 'Public']].map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => { setFilter(value); setSelectedIds([]) }}>{label}</button>)}
      </div></div>
      {visibleFiles.length > 0 && <div className="file-selection-toolbar">
        <label><input type="checkbox" checked={selectedFiles.length === visibleFiles.length} onChange={event => setSelectedIds(event.target.checked ? visibleFiles.map(file => file.id) : [])} disabled={busy} /> Select all shown</label>
        <span>{selectedFiles.length} selected</span>
        {selectedFiles.length > 0 && <button type="button" disabled={busy} onClick={() => setSelectedIds([])}>Clear selection</button>}
        <small>Drag across rows to select a range.</small>
      </div>}
      {selectedFiles.length > 0 && <form className="file-bulk-rename" onSubmit={bulkRename}>
        <label htmlFor="bulk-file-name">Rename {selectedFiles.length} files</label>
        <input id="bulk-file-name" value={bulkName} onChange={event => setBulkName(event.target.value)} placeholder="New name" maxLength={245} disabled={busy} />
        <span className="file-bulk-example">Example: {bulkName.trim() || 'New name'} 1{extensionOf(selectedFiles[0].name)}</span>
        <button type="submit" disabled={busy || !bulkName.trim()}>{busy ? 'Renaming...' : 'Rename selected'}</button>
      </form>}
      {message && <p className="file-error" role="alert">{message}</p>}
      <div className="file-table" role="table" aria-label="Files and folders">
        <div className="file-table-head" role="row"><span>Name</span><span>Type</span><span>Size</span><span>Date added</span><span>Actions</span></div>
        {!visibleFolders.length && !visibleFiles.length && <div className="file-empty"><FileGlyph folder /><strong>{search || filter !== 'all' ? 'No matching files' : 'This folder is empty'}</strong><p>{search || filter !== 'all' ? 'Try another search or filter.' : 'Create a folder or upload files to get started.'}</p></div>}
        {visibleFolders.map(f => <div className="file-row" role="row" key={f.id}>
          <div className="file-item"><FileGlyph folder />{renderName('folder', f)}</div>
          <span className="file-meta">Folder</span><span className="file-meta">—</span><span className="file-meta">{formatDate(f.created_at)}</span>
          <div className="file-actions"><button disabled={busy} onClick={() => startRename('folder', f)}>Rename</button><button className="danger" disabled={busy} onClick={() => removeFolder(f)}>Delete</button></div>
        </div>)}
        {visibleFiles.map(f => <div className={`file-row file-selectable-row${selectedIds.includes(f.id) ? ' selected' : ''}`} role="row" key={f.id} onPointerDown={event => selectRow(event, f.id)} onPointerEnter={event => extendSelection(event, f.id)}>
          <div className="file-item"><input className="file-select-checkbox" type="checkbox" checked={selectedIds.includes(f.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} disabled={busy} aria-label={`Select ${f.name}`} /><FileGlyph image={isImage(f)} />{renderName('file', f)}</div>
          <span className="file-meta">{fileKind(f)}{f.storage_bucket && f.storage_bucket !== 'admin-files' && <span className="file-public-label">Public</span>}</span><span className="file-meta">{formatSize(f.size_bytes)}</span><span className="file-meta">{formatDate(f.created_at)}</span>
          <div className="file-actions">{f.content_type?.startsWith('image/') && <button disabled={busy} onClick={() => openPreview(f)}>View</button>}<button disabled={busy} onClick={() => download(f)}>Download</button><button disabled={busy} onClick={() => startRename('file', f)}>Rename</button><button className="danger" disabled={busy} onClick={() => removeFile(f)}>Delete</button></div>
        </div>)}
      </div>
    </div>
    </div>
    {preview && <div className="file-preview-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { previewRequest.current++; setPreview(null) } }}>
      <div className="file-preview-dialog" role="dialog" aria-modal="true" aria-label={`Image preview: ${preview.name}`}>
        <div className="file-preview-header"><strong title={preview.name}>{preview.name}</strong><button type="button" aria-label="Close image viewer" onClick={() => { previewRequest.current++; setPreview(null) }}>×</button></div>
        <div className="file-preview-body">{preview.loading ? <p>Loading image…</p> : <img src={preview.url} alt={preview.name} />}</div>
      </div>
    </div>}
  </section>
}
