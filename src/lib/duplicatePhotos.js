import { supabase } from './supabase'
import { isImageFile, prepareExplorerFile, publishExplorerImage } from './explorerImages'

const imageName = name => name.split('/').pop().replace(/\.[^.]+$/, '').trim().toLowerCase()
const isImage = file => isImageFile({ name: file.name, type: file.content_type })

export function puppyStoragePath(url) {
  try {
    const marker = '/storage/v1/object/public/puppy-photos/'
    const parsed = new URL(url)
    if (parsed.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin) return null
    const index = parsed.pathname.indexOf(marker)
    return index < 0 ? null : decodeURIComponent(parsed.pathname.slice(index + marker.length))
  } catch { return null }
}

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

export async function signature(blob, name = '') {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  try {
    const readable = /hei[cf]/i.test(blob.type) || /\.(heic|heif)(?:\?|$)/i.test(name)
      ? await prepareExplorerFile(new File([blob], name.split('/').pop() || 'photo.heic', { type: blob.type })) : blob
    const image = await createImageBitmap(readable)
    const canvas = document.createElement('canvas')
    canvas.width = 9; canvas.height = 8
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, 9, 8)
    image.close()
    const pixels = context.getImageData(0, 0, 9, 8).data
    let visual = ''
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const left = (y * 9 + x) * 4
      const right = left + 4
      const brightness = offset => pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114
      visual += brightness(left) > brightness(right) ? '1' : '0'
    }
    return { hash, visual }
  } catch { return { hash, visual: null } }
}

export function visualDistance(first, second) {
  if (!first || !second) return 64
  let distance = 0
  for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) distance++
  return distance
}

export async function scanPuppyPhotoDuplicates(onProgress, signal) {
  const [files, gallery, puppies] = await Promise.all([
    allRows('admin_files', 'id, name, content_type, storage_path, storage_bucket', signal),
    allRows('puppy_photos', 'id, puppy_id, photo_url', signal),
    allRows('puppies', 'id, name, photo_url', signal)
  ])
  signal?.throwIfAborted()
  const images = files.filter(isImage)
  const puppyNames = new Map(puppies.map(puppy => [puppy.id, puppy.name]))
  const references = [
    ...gallery.filter(row => row.photo_url).map(row => ({ kind: 'gallery', id: row.id, url: row.photo_url, label: puppyNames.get(row.puppy_id) || 'Puppy gallery' })),
    ...puppies.filter(row => row.photo_url).map(row => ({ kind: 'cover', id: row.id, url: row.photo_url, label: `${row.name} cover` }))
  ].filter(row => puppyStoragePath(row.url))
  const alreadyLinked = new Set(images.filter(file => file.storage_bucket && file.storage_bucket !== 'admin-files').map(file => supabase.storage.from(file.storage_bucket).getPublicUrl(file.storage_path).data.publicUrl))
  const imageSignatures = []
  const uniqueUrls = [...new Set(references.map(row => row.url).filter(url => !alreadyLinked.has(url)))]
  const total = images.length + uniqueUrls.length + references.length + 1
  let completed = 0
  onProgress({ completed, total, label: 'Preparing image comparison' })
  for (const [index, file] of images.entries()) {
    signal?.throwIfAborted()
    onProgress({ completed, total, label: `Checking explorer image ${index + 1} of ${images.length}` })
    const { data, error } = await supabase.storage.from(file.storage_bucket || 'admin-files').download(file.storage_path, {}, { signal })
    signal?.throwIfAborted()
    if (!error) imageSignatures.push({ file, signature: await signature(data, file.name) })
    onProgress({ completed: ++completed, total, label: `Checked explorer image ${index + 1} of ${images.length}` })
  }
  const sourceSignatures = new Map()
  for (const [index, url] of uniqueUrls.entries()) {
    signal?.throwIfAborted()
    onProgress({ completed, total, label: `Checking puppy photo ${index + 1} of ${uniqueUrls.length}` })
    const { data, error } = await supabase.storage.from('puppy-photos').download(puppyStoragePath(url), {}, { signal })
    signal?.throwIfAborted()
    if (!error) sourceSignatures.set(url, await signature(data, url))
    onProgress({ completed: ++completed, total, label: `Checked puppy photo ${index + 1} of ${uniqueUrls.length}` })
  }
  const matches = references.map((row, index) => {
    signal?.throwIfAborted()
    onProgress({ completed: ++completed, total, label: `Comparing photo ${index + 1} of ${references.length}` })
    if (!sourceSignatures.has(row.url)) return null
    const source = sourceSignatures.get(row.url)
    const sourceName = imageName(puppyStoragePath(row.url))
    const candidates = imageSignatures.flatMap(({ file, signature: target }) => {
      const exact = source.hash === target.hash
      const distance = visualDistance(source.visual, target.visual)
      const sameName = imageName(file.name) === sourceName
      if (!exact && distance > 2 && !sameName) return []
      return [{ file, reason: exact ? 'Identical file' : distance <= 2 ? 'Image match' : 'Name match', score: exact ? 0 : distance <= 2 ? 1 : 2 }]
    }).sort((a, b) => a.score - b.score || a.file.name.localeCompare(b.file.name))
    return { ...row, candidates }
  }).filter(row => row?.candidates.length)
  const privateFiles = [...new Map(matches.flatMap(row => row.candidates.map(candidate => candidate.file)).filter(file => !file.storage_bucket || file.storage_bucket === 'admin-files').map(file => [file.id, file])).values()]
  onProgress({ completed, total, label: 'Preparing previews' })
  const previewUrls = new Map()
  for (let index = 0; index < privateFiles.length; index += 100) {
    signal?.throwIfAborted()
    const batch = privateFiles.slice(index, index + 100)
    const { data, error } = await supabase.storage.from('admin-files').createSignedUrls(batch.map(file => file.storage_path), 600)
    if (!error) batch.forEach((file, offset) => previewUrls.set(file.id, data[offset]?.signedUrl))
  }
  for (const file of images.filter(item => item.storage_bucket && item.storage_bucket !== 'admin-files')) previewUrls.set(file.id, supabase.storage.from(file.storage_bucket).getPublicUrl(file.storage_path).data.publicUrl)
  onProgress({ completed: total, total, label: 'Scan complete' })
  return matches.map(row => ({ ...row, candidates: row.candidates.map(candidate => ({ ...candidate, previewUrl: previewUrls.get(candidate.file.id) })) }))
}

export async function linkPuppyPhotoToExplorer(match, file) {
  const url = await publishExplorerImage(file, 'puppy-photos')
  const table = match.kind === 'cover' ? 'puppies' : 'puppy_photos'
  const { error } = await supabase.from(table).update({ photo_url: url }).eq('id', match.id).select('id').single()
  if (error) throw error
  const oldPath = puppyStoragePath(match.url)
  if (url === match.url || !oldPath) return { removed: false }
  const checks = await Promise.all(['puppy_photos', 'puppies', 'dogs'].map(name => supabase.from(name).select('id', { count: 'exact', head: true }).eq('photo_url', match.url)))
  if (checks.some(check => check.error) || checks.some(check => check.count > 0)) return { removed: false }
  const removed = await supabase.storage.from('puppy-photos').remove([oldPath])
  return { removed: !removed.error }
}
