import { supabase } from './supabase'

const base = import.meta.env.VITE_STORAGE_API_URL ? new URL(import.meta.env.VITE_STORAGE_API_URL, window.location.origin).href.replace(/\/$/, '') : ''
export const railwayStorageEnabled = Boolean(base)
const encoded = path => path.split('/').map(encodeURIComponent).join('/')

export function storageSource(url) {
  try {
    const parsed = new URL(url)
    const legacy = new URL(import.meta.env.VITE_SUPABASE_URL)
    const railwayMarker = base ? `${new URL(base).pathname.replace(/\/$/, '')}/public/` : null
    const marker = base && parsed.origin === new URL(base).origin && parsed.pathname.startsWith(railwayMarker)
      ? railwayMarker : parsed.origin === legacy.origin ? '/storage/v1/object/public/' : null
    if (!marker || !parsed.pathname.startsWith(marker)) return null
    const [bucket, ...parts] = parsed.pathname.slice(marker.length).split('/').map(decodeURIComponent)
    return parts.length ? { bucket, path: parts.join('/') } : null
  } catch { return null }
}

async function request(bucket, action, body) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) throw new Error('Please sign in again before accessing files.')
  const response = await fetch(`${base}/api/${bucket}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'File request failed.')
  return result
}

const result = async work => {
  try { return { data: await work(), error: null } }
  catch (error) { return { data: null, error } }
}

export const storage = {
  from(bucket) {
    if (!base) return supabase.storage.from(bucket)
    return {
      getPublicUrl(path) { return { data: { publicUrl: `${base}/public/${bucket}/${encoded(path)}` } } },
      createSignedUrl(path, expiresIn = 3600) {
        return result(async () => ({ signedUrl: (await request(bucket, 'sign-read', { paths: [path], expiresIn })).urls[0].signedUrl }))
      },
      createSignedUrls(paths, expiresIn = 3600) {
        return result(async () => (await request(bucket, 'sign-read', { paths, expiresIn })).urls)
      },
      download(path, _options, fetchOptions) {
        return result(async () => {
          const { urls } = await request(bucket, 'sign-read', { paths: [path], expiresIn: 600 })
          const response = await fetch(urls[0].signedUrl, { signal: fetchOptions?.signal })
          if (!response.ok) throw new Error(`Download failed (${response.status}).`)
          return response.blob()
        })
      },
      upload(path, file, options = {}) {
        return result(async () => {
          await uploadStorageFile(bucket, path, file, options)
          return { path }
        })
      },
      remove(paths) { return result(async () => (await request(bucket, 'delete', { paths })).deleted) },
    }
  },
}

export async function uploadStorageFile(bucket, path, file, { contentType = file.type || 'application/octet-stream', onProgress } = {}) {
  if (!base) {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error || !session) throw new Error('Please sign in again before uploading.')
    const tus = await import('tus-js-client')
    return new Promise((resolve, reject) => new tus.Upload(file, {
      endpoint: `${import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${session.access_token}` },
      metadata: { bucketName: bucket, objectName: path, contentType },
      chunkSize: 6 * 1024 * 1024, retryDelays: [0, 3000, 5000, 10000], removeFingerprintOnSuccess: true,
      onProgress, onError: reject, onSuccess: resolve,
    }).start())
  }
  const { uploadUrl } = await request(bucket, 'sign-upload', { path, contentType, size: file.size })
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('If-None-Match', '*')
    xhr.upload.onprogress = event => onProgress?.(event.loaded, event.total)
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and bucket CORS settings.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`))
    xhr.send(file)
  })
}
