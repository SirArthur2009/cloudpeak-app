import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import * as tus from 'tus-js-client'

const button = { padding: '0.5rem 0.8rem', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' }

export default function AdminFiles() {
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [folderId, setFolderId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

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
  const current = folders.find(f => f.id === folderId)
  const crumbs = []
  let ancestor = current
  while (ancestor && crumbs.length < folders.length) {
    crumbs.unshift(ancestor)
    ancestor = folders.find(f => f.id === ancestor.parent_id)
  }

  async function run(action) {
    setBusy(true); setMessage('')
    try { await action(); await refresh() } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  async function createFolder() {
    const name = prompt('Folder name:')?.trim()
    if (!name) return
    run(async () => {
      const { error } = await supabase.from('admin_folders').insert({ name, parent_id: folderId })
      if (error) throw error
    })
  }
  async function upload(event) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selected.length) return
    run(async () => {
      const failures = []
      for (const file of selected) {
        if (file.size > 50 * 1024 * 1024) { failures.push(`${file.name}: exceeds 50 MB`); continue }
        const path = crypto.randomUUID()
        let uploadError = null
        if (file.size > 6 * 1024 * 1024) {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) throw new Error('Please sign in again before uploading.')
          try {
            await new Promise((resolve, reject) => {
              new tus.Upload(file, {
                endpoint: `${import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`,
                headers: { authorization: `Bearer ${session.access_token}` },
                metadata: { bucketName: 'admin-files', objectName: path, contentType: file.type || 'application/octet-stream' },
                chunkSize: 6 * 1024 * 1024, retryDelays: [0, 3000, 5000, 10000], removeFingerprintOnSuccess: true,
                onError: reject, onSuccess: resolve
              }).start()
            })
          } catch (error) { uploadError = error }
        } else {
          const result = await supabase.storage.from('admin-files').upload(path, file, { contentType: file.type || 'application/octet-stream' })
          uploadError = result.error
        }
        if (uploadError) { failures.push(`${file.name}: ${uploadError.message}`); continue }
        const { error: saveError } = await supabase.from('admin_files').insert({ folder_id: folderId, name: file.name, storage_path: path, size_bytes: file.size, content_type: file.type || null })
        if (saveError) {
          await supabase.storage.from('admin-files').remove([path])
          failures.push(`${file.name}: ${saveError.message}`)
        }
      }
      if (failures.length) throw new Error(failures.join('; '))
    })
  }
  async function download(file) {
    run(async () => {
      const { data, error } = await supabase.storage.from('admin-files').download(file.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    })
  }
  async function rename(table, item) {
    const name = prompt('New name:', item.name)?.trim()
    if (!name || name === item.name) return
    run(async () => {
      const { error } = await supabase.from(table).update({ name }).eq('id', item.id)
      if (error) throw error
    })
  }
  async function removeFile(file) {
    if (!confirm(`Delete ${file.name}?`)) return
    run(async () => {
      const { error } = await supabase.storage.from('admin-files').remove([file.storage_path])
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
  return <section>
    <h3>Files</h3>
    <p style={{ color: '#666' }}>Private admin storage. Maximum file size: 50 MB.</p>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <button style={button} onClick={() => setFolderId(null)}>Files</button>
      {crumbs.map(f => <button style={button} key={f.id} onClick={() => setFolderId(f.id)}>{f.name}</button>)}
      <button style={button} disabled={busy} onClick={createFolder}>New folder</button>
      <label style={button}>Upload files <input type="file" multiple onChange={upload} disabled={busy} style={{ display: 'none' }} /></label>
    </div>
    {message && <p role="alert" style={{ color: '#a33' }}>{message}</p>}
    {!children.length && !currentFiles.length && <p style={{ color: '#777' }}>This folder is empty.</p>}
    {children.map(f => <div key={f.id} style={{ padding: 12, borderBottom: '1px solid #eee', display: 'flex', gap: 8, alignItems: 'center' }}>
      <button style={{ ...button, marginRight: 'auto' }} onClick={() => setFolderId(f.id)}>📁 {f.name}</button>
      <button style={button} disabled={busy} onClick={() => rename('admin_folders', f)}>Rename</button>
      <button style={button} disabled={busy} onClick={() => removeFolder(f)}>Delete</button>
    </div>)}
    {currentFiles.map(f => <div key={f.id} style={{ padding: 12, borderBottom: '1px solid #eee', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ marginRight: 'auto' }}>📄 {f.name} <small style={{ color: '#777' }}>({(f.size_bytes / 1024).toFixed(1)} KB)</small></span>
      <button style={button} disabled={busy} onClick={() => download(f)}>Download</button>
      <button style={button} disabled={busy} onClick={() => rename('admin_files', f)}>Rename</button>
      <button style={button} disabled={busy} onClick={() => removeFile(f)}>Delete</button>
    </div>)}
  </section>
}
