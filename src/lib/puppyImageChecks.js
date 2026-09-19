import { supabase } from './supabase'
import { puppyStoragePath, signature, visualDistance } from './duplicatePhotos'

export const isVideoPhoto = url => /\.(mp4|webm|mov)(?:\?|$)/i.test(url)

async function imageBlob(url, signal) {
  const path = puppyStoragePath(url)
  if (path) {
    const { data, error } = await supabase.storage.from('puppy-photos').download(path, {}, { signal })
    if (error) throw error
    return data
  }
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not check an existing photo (${response.status}).`)
  return response.blob()
}

export async function signaturesForPhotos(references, onProgress, signal) {
  const cache = new Map()
  const entries = []
  const photos = references.filter(item => item.url && !isVideoPhoto(item.url))
  for (const [index, reference] of photos.entries()) {
    signal?.throwIfAborted()
    onProgress?.({ completed: index, total: photos.length, label: `Checking photo ${index + 1} of ${photos.length}` })
    if (!cache.has(reference.url)) cache.set(reference.url, await signature(await imageBlob(reference.url, signal), reference.url))
    signal?.throwIfAborted()
    entries.push({ ...reference, signature: cache.get(reference.url) })
    onProgress?.({ completed: index + 1, total: photos.length, label: `Checked photo ${index + 1} of ${photos.length}` })
  }
  return entries
}

export function findImageMatch(candidate, entries) {
  const exact = entries.find(item => item.signature.hash === candidate.hash)
  if (exact) return { ...exact, kind: 'exact' }
  const similar = entries.find(item => visualDistance(item.signature.visual, candidate.visual) <= 2)
  return similar ? { ...similar, kind: 'similar' } : null
}

export async function checkCandidateImage(blob, references, additional = []) {
  const candidate = await signature(blob)
  const existing = await signaturesForPhotos(references)
  return { signature: candidate, match: findImageMatch(candidate, [...existing, ...additional]) }
}

export async function auditPuppyImages(references, onProgress, signal) {
  const count = references.filter(item => item.url && !isVideoPhoto(item.url)).length
  const entries = await signaturesForPhotos(references, progress => onProgress?.({ ...progress, total: count * 2 }), signal)
  const pairs = []
  for (let index = 0; index < entries.length; index++) {
    signal?.throwIfAborted()
    const match = findImageMatch(entries[index].signature, entries.slice(0, index))
    if (match) pairs.push({ first: match, second: entries[index], kind: match.kind })
    onProgress?.({ completed: count + index + 1, total: count * 2, label: `Comparing photo ${index + 1} of ${count}` })
  }
  return pairs
}
