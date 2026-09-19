import { supabase } from './supabase'
import { puppyStoragePath, signature, visualDistance } from './duplicatePhotos'

export const isVideoPhoto = url => /\.(mp4|webm|mov)(?:\?|$)/i.test(url)

async function imageBlob(url) {
  const path = puppyStoragePath(url)
  if (path) {
    const { data, error } = await supabase.storage.from('puppy-photos').download(path)
    if (error) throw error
    return data
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not check an existing photo (${response.status}).`)
  return response.blob()
}

export async function signaturesForPhotos(references) {
  const cache = new Map()
  const entries = []
  for (const reference of references.filter(item => item.url && !isVideoPhoto(item.url))) {
    if (!cache.has(reference.url)) cache.set(reference.url, await signature(await imageBlob(reference.url)))
    entries.push({ ...reference, signature: cache.get(reference.url) })
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

export async function auditPuppyImages(references) {
  const entries = await signaturesForPhotos(references)
  const pairs = []
  for (let index = 0; index < entries.length; index++) {
    const match = findImageMatch(entries[index].signature, entries.slice(0, index))
    if (match) pairs.push({ first: match, second: entries[index], kind: match.kind })
  }
  return pairs
}
