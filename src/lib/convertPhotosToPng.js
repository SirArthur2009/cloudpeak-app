import * as tus from 'tus-js-client'
import { supabase } from './supabase'
import { isImageFile, prepareExplorerFile } from './explorerImages'

async function allRows(table, columns, signal) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    signal?.throwIfAborted()
    const { data, error } = await supabase.from(table).select(columns).order('id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 500) return rows
  }
}

function publicSource(url) {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin) return null
    const marker = '/storage/v1/object/public/'
    const index = parsed.pathname.indexOf(marker)
    if (index < 0) return null
    const [bucket, ...parts] = decodeURIComponent(parsed.pathname.slice(index + marker.length)).split('/')
    return ['puppy-photos', 'dog-photos'].includes(bucket) && parts.length ? { bucket, path: parts.join('/') } : null
  } catch { return null }
}

async function uploadPng(bucket, path, file) {
  if (file.size <= 6 * 1024 * 1024) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: 'image/png' })
    if (error) throw error
    return
  }
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) throw new Error('Please sign in again before converting images.')
  await new Promise((resolve, reject) => new tus.Upload(file, {
    endpoint: `${import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`,
    headers: { authorization: `Bearer ${session.access_token}` },
    metadata: { bucketName: bucket, objectName: path, contentType: 'image/png' },
    chunkSize: 6 * 1024 * 1024, retryDelays: [0, 3000, 5000, 10000], removeFingerprintOnSuccess: true,
    onError: reject, onSuccess: resolve
  }).start())
}

export async function convertPhotosToPng(onProgress, signal) {
  const [files, gallery, puppies, dogs] = await Promise.all([
    allRows('admin_files', 'id, name, content_type, storage_bucket, storage_path', signal),
    allRows('puppy_photos', 'id, photo_url', signal),
    allRows('puppies', 'id, photo_url', signal),
    allRows('dogs', 'id, photo_url', signal)
  ])
  signal?.throwIfAborted()
  const sources = new Map()
  function add(bucket, path, item) {
    const key = `${bucket}/${path}`
    if (!sources.has(key)) sources.set(key, { bucket, path, files: [], references: [] })
    sources.get(key)[item.table === 'admin_files' ? 'files' : 'references'].push(item)
  }
  for (const file of files) if (isImageFile({ name: file.name, type: file.content_type })) add(file.storage_bucket || 'admin-files', file.storage_path, { table: 'admin_files', ...file })
  for (const [table, rows] of [['puppy_photos', gallery], ['puppies', puppies], ['dogs', dogs]]) {
    for (const row of rows) {
      const source = publicSource(row.photo_url)
      if (source && /\.(jpe?g|png|heic|heif|webp|gif|avif|bmp|tiff?|svg)$/i.test(source.path)) add(source.bucket, source.path, { table, ...row })
    }
  }
  const pending = [...sources.values()].filter(source =>
    source.files.some(file => file.content_type !== 'image/png' || !file.name.toLowerCase().endsWith('.png')) ||
    (source.bucket !== 'admin-files' && !source.path.toLowerCase().endsWith('.png')))
  const result = { converted: 0, skipped: 0, failed: [], cancelled: false }
  for (const [index, source] of pending.entries()) {
    if (signal?.aborted) { result.cancelled = true; break }
    const label = source.files[0]?.name || source.path.split('/').pop()
    onProgress({ current: index + 1, completed: index, total: pending.length, name: label, percent: Math.round(index / pending.length * 100) })
    try {
      const { data, error } = await supabase.storage.from(source.bucket).download(source.path)
      if (error) throw error
      const prepared = await prepareExplorerFile(new File([data], label, { type: source.files[0]?.content_type || data.type }))
      if (prepared.type !== 'image/png') throw new Error('Image could not be converted to PNG.')
      const newPath = `${crypto.randomUUID()}.png`
      await uploadPng(source.bucket, newPath, prepared)
      const newUrl = source.bucket === 'admin-files' ? null : supabase.storage.from(source.bucket).getPublicUrl(newPath).data.publicUrl
      for (const file of source.files) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.png'
        const { error: updateError } = await supabase.from('admin_files').update({ name, storage_path: newPath, content_type: 'image/png', size_bytes: prepared.size }).eq('id', file.id)
        if (updateError) throw updateError
      }
      for (const reference of source.references) {
        const { error: updateError } = await supabase.from(reference.table).update({ photo_url: newUrl }).eq('id', reference.id)
        if (updateError) throw updateError
      }
      const { error: removeError } = await supabase.storage.from(source.bucket).remove([source.path])
      if (removeError) throw removeError
      result.converted++
    } catch (error) {
      result.failed.push(`${label}: ${error.message}`)
    }
    onProgress({ current: index + 1, completed: index + 1, total: pending.length, name: label, percent: Math.round((index + 1) / pending.length * 100) })
  }
  result.skipped = sources.size - pending.length
  if (!result.cancelled) onProgress({ current: pending.length, completed: pending.length, total: pending.length, name: 'Finished', percent: 100 })
  return result
}
