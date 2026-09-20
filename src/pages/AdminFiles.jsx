import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import * as tus from 'tus-js-client'
import { browserPreviewBlob, prepareExplorerFile } from '../lib/explorerImages'
import { sizedImageUrl, originalOnError } from '../lib/imageLoading'
import { convertPhotosToPng } from '../lib/convertPhotosToPng'
import { estimatedTimeRemaining } from '../lib/progressEta'
import './AdminFiles.css'

const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`
const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fileKind = file => file.content_type?.startsWith('image/') ? 'Image' : file.content_type === 'application/pdf' ? 'PDF document' : file.name.includes('.') ? `${file.name.split('.').pop().toUpperCase()} file` : 'File'
const extensionOf = name => { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot) : '' }
const isImage = file => file.content_type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name)
const safeZipName = name => (name.replace(/[\\/]/g, '_').replace(/^\.+$/, '_') || 'Untitled')
const PAGE_SIZE = 100
const EMPTY_ROWS = []

async function fetchAllRows(table, folderId) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from(table).select('*').order('name').order('id').range(offset, offset + 499)
    if (table === 'admin_files') query = folderId === null ? query.is('folder_id', null) : query.eq('folder_id', folderId)
    const { data, error } = await query
    if (error) throw error
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

async function fetchFolderFiles(folderIds) {
  const files = []
  for (let start = 0; start < folderIds.length; start += 100) {
    const ids = folderIds.slice(start, start + 100)
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('admin_files').select('*').in('folder_id', ids).order('name').order('id').range(offset, offset + 499)
      if (error) throw error
      files.push(...data)
      if (data.length < 500) break
    }
  }
  return files
}

function folderContents(root, allFolders, allFiles) {
  const entries = []
  const seen = new Set()
  const childrenByParent = new Map()
  for (const folder of allFolders) {
    if (!childrenByParent.has(folder.parent_id)) childrenByParent.set(folder.parent_id, [])
    childrenByParent.get(folder.parent_id).push(folder)
  }
  function visit(folder, path, depth) {
    if (seen.has(folder.id)) return
    seen.add(folder.id)
    entries.push({ folder, path, depth })
    const usedNames = new Set()
    for (const child of childrenByParent.get(folder.id) || EMPTY_ROWS) {
      const base = safeZipName(child.name)
      let name = base
      let number = 2
      while (usedNames.has(name.toLowerCase())) name = `${base} (${number++})`
      usedNames.add(name.toLowerCase())
      visit(child, `${path}/${name}`, depth + 1)
    }
  }
  visit(root, safeZipName(root.name), 0)
  return { entries, files: allFiles.filter(file => seen.has(file.folder_id)) }
}

function FileGlyph({ folder = false, image = false }) {
  return <span className={`file-icon${folder ? ' folder-icon' : image ? ' image-icon' : ''}`} aria-hidden="true">
    {folder ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M3 6.5h6l2 2H21v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z"/><path d="M3 10.5h18"/></svg>
      : image ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M6 2.5h8l4 4V21H6a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2Z"/><path d="M14 2.5v5h5M8 12h8M8 16h8"/></svg>}
  </span>
}

async function loadPreviewUrl(file) {
  const storage = supabase.storage.from(file.storage_bucket || 'admin-files')
  const transform = /\.(gif|svg|heic|heif)$/i.test(file.name) ? undefined : { transform: { width: 1600, quality: 85 } }
  let { data, error } = await storage.download(file.storage_path, transform)
  if (error && transform) ({ data, error } = await storage.download(file.storage_path))
  if (error) throw error
  return URL.createObjectURL(await browserPreviewBlob(data, file))
}

const thumbnailUrlCache = new Map()
function signedThumbnailUrl(path) {
  const cached = thumbnailUrlCache.get(path)
  if (cached && cached.expires > Date.now()) return cached.promise
  const promise = supabase.storage.from('admin-files').createSignedUrl(path, 3600, { transform: { width: 120, quality: 75 } })
    .then(({ data, error }) => {
      if (error) throw error
      return data.signedUrl
    })
  thumbnailUrlCache.set(path, { promise, expires: Date.now() + 50 * 60 * 1000 })
  promise.catch(() => thumbnailUrlCache.delete(path))
  return promise
}

function FileThumbnail({ file }) {
  const thumbnailRef = useRef(null)
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined')
  const [url, setUrl] = useState('')
  const publicUrl = file.storage_bucket && file.storage_bucket !== 'admin-files'
    ? supabase.storage.from(file.storage_bucket).getPublicUrl(file.storage_path).data.publicUrl : ''
  useEffect(() => {
    if (nearViewport || !thumbnailRef.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) { setNearViewport(true); observer.disconnect() }
    }, { rootMargin: '300px' })
    observer.observe(thumbnailRef.current)
    return () => observer.disconnect()
  }, [nearViewport])
  useEffect(() => {
    if (!nearViewport || publicUrl) return
    let active = true
    signedThumbnailUrl(file.storage_path).then(value => { if (active) setUrl(value) }).catch(() => {})
    return () => { active = false }
  }, [nearViewport, publicUrl, file.storage_path])
  const fallback = event => {
    if (publicUrl) { originalOnError(event, publicUrl); return }
    if (event.currentTarget.dataset.fallback) return
    event.currentTarget.dataset.fallback = 'true'
    supabase.storage.from('admin-files').createSignedUrl(file.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl && event.target?.isConnected) event.target.src = data.signedUrl
    })
  }
  return <span ref={thumbnailRef} className="file-thumbnail-wrap">{nearViewport && (publicUrl || url) ? <img className="file-thumbnail" src={publicUrl ? sizedImageUrl(publicUrl, 120) : url} onError={fallback} alt="" loading="lazy" decoding="async" /> : <FileGlyph image />}</span>
}

export default function AdminFiles({ onOpenCleanup }) {
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [listingLoading, setListingLoading] = useState(true)
  const [folderId, setFolderId] = useState(null)
  const activeFolderId = useRef(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null)
  const [preview, setPreview] = useState(null)
  const previewRequest = useRef(0)
  const previewCache = useRef(new Map())
  const listingRequest = useRef(0)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkName, setBulkName] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [openMenuId, setOpenMenuId] = useState(null)
  const [folderProgress, setFolderProgress] = useState(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [conversionCancelling, setConversionCancelling] = useState(false)
  const conversionController = useRef(null)
  const dragAnchor = useRef(null)

  useEffect(() => {
    const stopDrag = () => { dragAnchor.current = null }
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    return () => { window.removeEventListener('pointerup', stopDrag); window.removeEventListener('pointercancel', stopDrag) }
  }, [])

  useEffect(() => {
    if (!openMenuId) return
    const closeOutside = event => { if (!event.target.closest('.file-menu-wrap')) setOpenMenuId(null) }
    const closeEscape = event => { if (event.key === 'Escape') setOpenMenuId(null) }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', closeEscape) }
  }, [openMenuId])

  useEffect(() => {
    if (!preview) return
    const onKeyDown = event => { if (event.key === 'Escape') { previewRequest.current++; setPreview(null) } }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview])

  useEffect(() => () => {
    for (const entry of previewCache.current.values()) entry.then(url => URL.revokeObjectURL(url)).catch(() => {})
    previewCache.current.clear()
  }, [])
  useEffect(() => {
    if (preview) return
    for (const entry of previewCache.current.values()) entry.then(url => URL.revokeObjectURL(url)).catch(() => {})
    previewCache.current.clear()
  }, [preview])

  const refresh = useCallback(async (targetFolderId = activeFolderId.current) => {
    const request = ++listingRequest.current
    const [nextFolders, nextFiles] = await Promise.all([fetchAllRows('admin_folders'), fetchAllRows('admin_files', targetFolderId)])
    if (request === listingRequest.current) {
      setFolders(nextFolders)
      setFiles(nextFiles)
      setListingLoading(false)
    }
  }, [])
  useEffect(() => {
    const requestRef = listingRequest
    refresh(folderId).catch(error => { setListingLoading(false); setMessage(error.message) })
    return () => { requestRef.current++ }
  }, [folderId, refresh])

  const foldersByParent = useMemo(() => {
    const grouped = new Map()
    for (const folder of folders) {
      if (!grouped.has(folder.parent_id)) grouped.set(folder.parent_id, [])
      grouped.get(folder.parent_id).push(folder)
    }
    return grouped
  }, [folders])
  const children = foldersByParent.get(folderId) || EMPTY_ROWS
  const currentFiles = files
  const folderImages = useMemo(() => currentFiles.filter(isImage), [currentFiles])
  const visibleFiles = useMemo(() => currentFiles.filter(file => file.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === 'images' && isImage(file) || filter === 'other' && !isImage(file) || filter === 'public' && file.storage_bucket && file.storage_bucket !== 'admin-files')), [currentFiles, search, filter])
  const displayedFiles = visibleFiles.slice(0, visibleCount)
  const visibleFolders = filter === 'all' ? children.filter(folder => folder.name.toLowerCase().includes(search.toLowerCase())) : []
  const selectedIdSet = new Set(selectedIds)
  const selectedFiles = visibleFiles.filter(f => selectedIdSet.has(f.id))
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
    for (const folder of foldersByParent.get(parentId) || []) {
      if (visitedFolders.has(folder.id)) continue
      visitedFolders.add(folder.id)
      folderNav.push({ ...folder, depth })
      collectFolders(folder.id, depth + 1)
    }
  }
  collectFolders(null, 0)

  function goToFolder(id) {
    setListingLoading(true)
    if (id === folderId) refresh().catch(error => { setListingLoading(false); setMessage(error.message) })
    else { activeFolderId.current = id; setFolderId(id); setFiles([]) }
    setSelectedIds([]); setSearch(''); setFilter('all'); setVisibleCount(PAGE_SIZE); setEditing(null); setOpenMenuId(null)
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
  const openPreview = useCallback(async file => {
    const request = ++previewRequest.current
    setPreview({ id: file.id, name: file.name, loading: true })
    try {
      let pending = previewCache.current.get(file.id)
      if (!pending) {
        pending = loadPreviewUrl(file)
        previewCache.current.set(file.id, pending)
        pending.catch(() => { if (previewCache.current.get(file.id) === pending) previewCache.current.delete(file.id) })
      }
      const url = await pending
      if (request !== previewRequest.current) return
      setPreview({ id: file.id, name: file.name, url })
    } catch (error) {
      if (request === previewRequest.current) { setPreview(null); setMessage(error.message) }
    }
  }, [])
  useEffect(() => {
    if (!preview?.url || folderImages.length < 2) return
    const index = folderImages.findIndex(file => file.id === preview.id)
    if (index < 0) return
    const keep = new Set([preview.id])
    for (const offset of [-1, 1]) {
      const file = folderImages[(index + offset + folderImages.length) % folderImages.length]
      keep.add(file.id)
      if (!previewCache.current.has(file.id)) {
        const pending = loadPreviewUrl(file)
        previewCache.current.set(file.id, pending)
        pending.catch(() => { if (previewCache.current.get(file.id) === pending) previewCache.current.delete(file.id) })
      }
    }
    for (const [id, pending] of previewCache.current) {
      if (!keep.has(id)) {
        previewCache.current.delete(id)
        pending.then(url => URL.revokeObjectURL(url)).catch(() => {})
      }
    }
  }, [preview?.id, preview?.url, folderImages])
  const openAdjacentPreview = useCallback(direction => {
    if (!preview) return
    const currentIndex = folderImages.findIndex(file => file.id === preview.id)
    if (currentIndex < 0 || folderImages.length < 2) return
    const next = folderImages[(currentIndex + direction + folderImages.length) % folderImages.length]
    openPreview(next)
  }, [preview, folderImages, openPreview])
  useEffect(() => {
    if (!preview) return
    const onKeyDown = event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); openAdjacentPreview(-1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); openAdjacentPreview(1) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview, openAdjacentPreview])
  async function download(file) {
    setBusy(true); setMessage('')
    try {
      const { data, error } = await supabase.storage.from(file.storage_bucket || 'admin-files').download(file.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  function startRename(type, item) {
    setOpenMenuId(null)
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
    let contents
    try {
      const tree = folderContents(folder, folders, EMPTY_ROWS)
      contents = { entries: tree.entries, files: await fetchFolderFiles(tree.entries.map(entry => entry.folder.id)) }
    } catch (error) { setMessage(error.message); return }
    if (!confirm(`Delete “${folder.name}” and everything inside it (${contents.files.length} files, ${contents.entries.length} folders)? This cannot be undone.`)) return
    await run(async () => {
      const publicFiles = contents.files.filter(file => (file.storage_bucket || 'admin-files') !== 'admin-files')
      for (const file of publicFiles) {
        const url = supabase.storage.from(file.storage_bucket).getPublicUrl(file.storage_path).data.publicUrl
        const checks = await Promise.all(['puppy_photos', 'puppies', 'dogs'].map(table => supabase.from(table).select('id', { count: 'exact', head: true }).eq('photo_url', url)))
        if (checks.some(check => check.error)) throw checks.find(check => check.error).error
        if (checks.some(check => check.count > 0)) throw new Error(`“${file.name}” is used on the site. Remove its photo references before deleting this folder.`)
      }
      const byBucket = new Map()
      for (const file of contents.files) {
        const bucket = file.storage_bucket || 'admin-files'
        if (!byBucket.has(bucket)) byBucket.set(bucket, [])
        byBucket.get(bucket).push(file)
      }
      for (const [bucket, bucketFiles] of byBucket) {
        for (let index = 0; index < bucketFiles.length; index += 100) {
          const batch = bucketFiles.slice(index, index + 100)
          const { error: storageError } = await supabase.storage.from(bucket).remove(batch.map(file => file.storage_path))
          if (storageError) throw storageError
          const { error: rowsError } = await supabase.from('admin_files').delete().in('id', batch.map(file => file.id))
          if (rowsError) throw rowsError
        }
      }
      for (const { folder: child } of [...contents.entries].reverse()) {
        const { error } = await supabase.from('admin_folders').delete().eq('id', child.id)
        if (error) throw error
      }
      if (contents.entries.some(entry => entry.folder.id === folderId)) goToFolder(folder.parent_id)
      setSelectedIds([])
    })
  }
  async function downloadFolder(folder) {
    setBusy(true); setMessage(''); setOpenMenuId(null)
    try {
      const { default: JSZip } = await import('jszip')
      const tree = folderContents(folder, folders, EMPTY_ROWS)
      const entries = tree.entries
      const folderFiles = await fetchFolderFiles(entries.map(entry => entry.folder.id))
      const zip = new JSZip()
      const paths = new Map(entries.map(entry => [entry.folder.id, entry.path]))
      entries.forEach(entry => zip.folder(entry.path))
      const usedPaths = new Set()
      const downloads = folderFiles.map(file => {
        const base = safeZipName(file.name)
        const stem = base.slice(0, base.length - extensionOf(base).length)
        const ext = extensionOf(base)
        let name = base
        let number = 2
        while (usedPaths.has(`${paths.get(file.folder_id)}/${name}`.toLowerCase())) name = `${stem} (${number++})${ext}`
        const path = `${paths.get(file.folder_id)}/${name}`
        usedPaths.add(path.toLowerCase())
        return { file, path }
      })
      let completed = 0
      for (let index = 0; index < downloads.length; index += 3) {
        const batch = downloads.slice(index, index + 3)
        const blobs = await Promise.all(batch.map(async ({ file }) => {
          const { data, error } = await supabase.storage.from(file.storage_bucket || 'admin-files').download(file.storage_path)
          if (error) throw error
          completed++
          setFolderProgress({ name: file.name, percent: Math.round(completed / Math.max(downloads.length, 1) * 80) })
          return data
        }))
        batch.forEach(({ path }, position) => zip.file(path, blobs[position]))
      }
      setFolderProgress({ name: 'Creating ZIP archive', percent: 80 })
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => setFolderProgress({ name: 'Creating ZIP archive', percent: 80 + Math.round(metadata.percent * .2) }))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `${safeZipName(folder.name)}.zip`; document.body.append(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) { setMessage(error.message) }
    finally { setFolderProgress(null); setBusy(false) }
  }
  async function convertAllImages() {
    setToolsOpen(false)
    if (!confirm('Convert all tracked images in Files and puppy/dog photos to PNG? Photo links will be updated. This may take several minutes.')) return
    const startedAt = Date.now()
    const controller = new AbortController()
    conversionController.current = controller
    setBusy(true); setConversionCancelling(false); setMessage(''); setFolderProgress({ current: 0, completed: 0, total: 0, name: 'Finding images', percent: 0, eta: 'Estimating…' })
    try {
      const result = await convertPhotosToPng(progress => setFolderProgress({ ...progress, eta: controller.signal.aborted ? 'Stopping after this image…' : estimatedTimeRemaining(startedAt, progress.completed, progress.total) }), controller.signal)
      await refresh()
      setMessage(`${result.cancelled ? 'Conversion cancelled. ' : ''}Converted ${result.converted} images to PNG; ${result.skipped} were already PNG.${result.failed.length ? ` ${result.failed.length} failed: ${result.failed.join('; ')}` : ''}`)
    } catch (error) { setMessage(controller.signal.aborted ? 'Conversion cancelled before any images were changed.' : `Conversion stopped: ${error.message}`) }
    finally { conversionController.current = null; setFolderProgress(null); setConversionCancelling(false); setBusy(false) }
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
      : <button type="button" className="file-name-button" disabled={busy} onClick={() => isImage(item) ? openPreview(item) : download(item)} title={`${isImage(item) ? 'View' : 'Download'} ${item.name}`}>{item.name}</button>

  return <section className="file-explorer">
    <div className="file-explorer-heading">
      <div><span className="file-eyebrow">ADMIN LIBRARY</span><h3>Files</h3><p>Organize photos and documents for Cloud Peak.</p></div>
      <div className="file-toolbar">
        <div className="file-toolbar-tools"><button type="button" className="file-secondary-button" disabled={busy} aria-expanded={toolsOpen} onClick={() => setToolsOpen(open => !open)}>Tools ▾</button>{toolsOpen && <div className="file-tools-menu"><button type="button" onClick={convertAllImages}>Convert all images to PNG</button></div>}</div>
        <button type="button" className="file-secondary-button" disabled={busy} onClick={() => setCreatingFolder(true)}>+ New folder</button>
        <label className={`file-secondary-button${busy ? ' disabled' : ''}`}>Upload folder<input type="file" webkitdirectory="" directory="" onChange={event => upload(event, true)} disabled={busy} /></label>
        <label className={`file-primary-button${busy ? ' disabled' : ''}`}>Upload files<input type="file" multiple onChange={event => upload(event)} disabled={busy} /></label>
      </div>
    </div>
    <div className="file-workspace">
      <aside className="file-sidebar" aria-label="Folder navigation">
        <div className="file-sidebar-heading">BROWSE <span>{folders.length} folders</span></div>
        <nav className="file-folder-tree" aria-label="Folders">
          <button type="button" className={folderId === null ? 'active' : ''} onClick={() => goToFolder(null)}><span className="file-sidebar-symbol">⌂</span><span>Files home</span>{folderId === null && <small>{files.length}</small>}</button>
          {folderNav.map(folder => <button type="button" key={folder.id} className={folderId === folder.id ? 'active' : ''} style={{ '--folder-depth': folder.depth }} onClick={() => goToFolder(folder.id)} title={folder.name}><span className="file-sidebar-symbol">▰</span><span>{folder.name}</span>{folderId === folder.id && <small>{files.length}</small>}</button>)}
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
      {folderProgress && <div className="file-upload-progress" role="status" aria-live="polite"><div><strong>{folderProgress.total !== undefined ? folderProgress.total ? `Converting image ${folderProgress.current} of ${folderProgress.total}` : 'Finding images to convert' : 'Downloading folder'}</strong><span>{folderProgress.percent}%</span></div><p title={folderProgress.name}>{folderProgress.name}{folderProgress.eta ? ` · ${folderProgress.eta}` : ''}</p><progress value={folderProgress.percent} max="100" aria-label="Image processing progress" />{folderProgress.total !== undefined && <button type="button" className="file-cancel-work" disabled={conversionCancelling} onClick={() => { conversionController.current?.abort(); setConversionCancelling(true); setFolderProgress(progress => progress && { ...progress, eta: 'Stopping after this image…' }) }}>Cancel conversion</button>}</div>}
      <nav className="file-breadcrumbs" aria-label="Folder path">
        <button onClick={() => goToFolder(null)} aria-current={folderId === null ? 'page' : undefined}>Files</button>
        {crumbs.map(f => <span key={f.id} className="file-crumb"><span aria-hidden="true">›</span><button onClick={() => goToFolder(f.id)} aria-current={folderId === f.id ? 'page' : undefined}>{f.name}</button></span>)}
      </nav>
      <div className="file-location"><div><strong>{current?.name || 'Files home'}</strong><span>{children.length} folders · {currentFiles.length} files</span></div>{current && <div className="file-location-actions"><button type="button" disabled={busy} onClick={() => downloadFolder(current)}>Download folder</button><button type="button" className="danger" disabled={busy} onClick={() => removeFolder(current)}>Delete folder</button></div>}</div>
      <div className="file-controls"><label className="file-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search this folder" placeholder="Search this folder" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); setSelectedIds([]) }} /></label><div className="file-filters" role="group" aria-label="Filter files">
        {[['all', 'All'], ['images', 'Images'], ['other', 'Other files'], ['public', 'Public']].map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => { setFilter(value); setVisibleCount(PAGE_SIZE); setSelectedIds([]) }}>{label}</button>)}
      </div></div>
      {visibleFiles.length > 0 && <div className="file-selection-toolbar">
        <label><input type="checkbox" checked={selectedFiles.length === visibleFiles.length} onChange={event => setSelectedIds(event.target.checked ? visibleFiles.map(file => file.id) : [])} disabled={busy} /> Select all matches</label>
        <span>{selectedFiles.length} selected</span>
        {selectedFiles.length > 0 && <button type="button" disabled={busy} onClick={() => setSelectedIds([])}>Clear selection</button>}
        <small>Desktop: press on a file row and drag across rows. Mobile: tap checkboxes.</small>
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
        {listingLoading && <div className="file-empty" role="status">Loading files…</div>}
        {!listingLoading && !visibleFolders.length && !visibleFiles.length && <div className="file-empty"><FileGlyph folder /><strong>{search || filter !== 'all' ? 'No matching files' : 'This folder is empty'}</strong><p>{search || filter !== 'all' ? 'Try another search or filter.' : 'Create a folder or upload files to get started.'}</p></div>}
        {visibleFolders.map(f => <div className="file-row" role="row" key={f.id}>
          <div className="file-item"><FileGlyph folder />{renderName('folder', f)}</div>
          <span className="file-meta">Folder</span><span className="file-meta">—</span><span className="file-meta">{formatDate(f.created_at)}</span>
          <div className="file-actions"><button disabled={busy} onClick={() => downloadFolder(f)}>Download</button><button disabled={busy} onClick={() => startRename('folder', f)}>Rename</button><button className="danger" disabled={busy} onClick={() => removeFolder(f)}>Delete</button></div>
        </div>)}
        {displayedFiles.map(f => <div className={`file-row file-selectable-row${selectedIdSet.has(f.id) ? ' selected' : ''}`} role="row" key={f.id} onPointerDown={event => selectRow(event, f.id)} onPointerEnter={event => extendSelection(event, f.id)}>
          <div className="file-item"><input className="file-select-checkbox" type="checkbox" checked={selectedIdSet.has(f.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} disabled={busy} aria-label={`Select ${f.name}`} />{isImage(f) ? <FileThumbnail file={f} /> : <FileGlyph />}{renderName('file', f)}</div>
          <span className="file-meta">{fileKind(f)}{f.storage_bucket && f.storage_bucket !== 'admin-files' && <span className="file-public-label">Public</span>}</span><span className="file-meta">{formatSize(f.size_bytes)}</span><span className="file-meta">{formatDate(f.created_at)}</span>
          <div className="file-actions"><div className="file-menu-wrap"><button type="button" className="file-menu-trigger" disabled={busy} aria-label={`Actions for ${f.name}`} aria-expanded={openMenuId === f.id} aria-haspopup="menu" onClick={() => setOpenMenuId(id => id === f.id ? null : f.id)}>Actions <span aria-hidden="true">▾</span></button>{openMenuId === f.id && <div className="file-menu" role="menu">{isImage(f) && <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); openPreview(f) }}>View</button>}<button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); download(f) }}>Download</button><button type="button" role="menuitem" onClick={() => startRename('file', f)}>Rename</button><button type="button" role="menuitem" className="danger" onClick={() => { setOpenMenuId(null); removeFile(f) }}>Delete</button></div>}</div></div>
        </div>)}
      </div>
      {visibleFiles.length > visibleCount && <div className="file-load-more"><span>Showing {displayedFiles.length} of {visibleFiles.length} files</span><button type="button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show 100 more</button></div>}
    </div>
    </div>
    {preview && <div className="file-preview-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { previewRequest.current++; setPreview(null) } }}>
      <div className="file-preview-dialog" role="dialog" aria-modal="true" aria-label={`Image preview: ${preview.name}`}>
        <div className="file-preview-header"><strong title={preview.name}>{preview.name}</strong><span>{folderImages.findIndex(file => file.id === preview.id) + 1} of {folderImages.length}</span><button type="button" aria-label="Close image viewer" onClick={() => { previewRequest.current++; setPreview(null) }}>×</button></div>
        <div className={`file-preview-body${folderImages.length > 1 ? ' has-navigation' : ''}`}>
          {folderImages.length > 1 && <button className="file-preview-arrow" type="button" aria-label="Previous picture" onClick={() => openAdjacentPreview(-1)}>‹</button>}
          {preview.loading ? <p>Loading image…</p> : <img src={preview.url} alt={preview.name} />}
          {folderImages.length > 1 && <button className="file-preview-arrow" type="button" aria-label="Next picture" onClick={() => openAdjacentPreview(1)}>›</button>}
        </div>
      </div>
    </div>}
  </section>
}
