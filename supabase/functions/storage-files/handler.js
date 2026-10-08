import { objectKey, publicBuckets, canAccess } from './policy.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
async function readJson(req) {
  const reader = req.body?.getReader()
  if (!reader) throw fail(400, 'Invalid JSON.')
  const chunks = []; let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.length
    if (length > 65536) { await reader.cancel(); throw fail(413, 'Request too large.') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { throw fail(400, 'Invalid JSON.') }
}

// Shared by the deployed Deno function and the Node local runner.
export function createStorageHandler({ origins, getUser, getRole, ownsSoldPuppy, readUrl, uploadUrl, remove, health }) {
  if (!origins.size || origins.has('*')) throw new Error('Specific ALLOWED_ORIGINS are required.')
  return async req => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    const json = (status, value) => { headers.set('Content-Type', 'application/json'); return new Response(JSON.stringify(value), { status, headers }) }
    try {
      const origin = req.headers.get('origin')
      if (origin && !origins.has(origin)) throw fail(403, 'Origin is not allowed.')
      if (origin) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin') }
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, x-client-info, content-type')
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      let path = new URL(req.url).pathname
      const functionPrefix = '/storage-files'
      const index = path.indexOf(functionPrefix)
      if (index >= 0 && (path[index + functionPrefix.length] === '/' || path.length === index + functionPrefix.length)) path = path.slice(index + functionPrefix.length)
      if (path === '/health' && req.method === 'GET') { await health(); return json(200, { ok: true }) }
      const match = path.match(/^\/(public|api)\/([^/]+)\/(.+)$/)
      if (!match) throw fail(404, 'Not found.')
      const [, type, bucket, rest] = match
      if (type === 'public') {
        if (!['GET', 'HEAD'].includes(req.method) || !publicBuckets.has(bucket)) throw fail(404, 'Not found.')
        let decoded
        try { decoded = decodeURIComponent(rest) } catch { throw fail(400, 'Invalid file path.') }
        const location = await readUrl(objectKey(bucket, decoded), 3600)
        headers.set('Location', location); headers.set('Cache-Control', 'public, max-age=300')
        return new Response(null, { status: 302, headers })
      }
      if (req.method !== 'POST') throw fail(405, 'Method not allowed.')
      if (!['sign-read', 'sign-upload', 'delete'].includes(rest)) throw fail(404, 'Not found.')
      const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
      if (!token) throw fail(401, 'Please sign in.')
      const user = await getUser(token)
      if (!user) throw fail(401, 'Session expired. Please sign in again.')
      const role = await getRole(token, user.id)
      const ownerAccess = role === 'client' && bucket === 'owner-puppy-photos' && ['sign-read','sign-upload'].includes(rest)
      if (!canAccess(role, bucket, rest) && !ownerAccess) throw fail(403, 'Admin access required.')
      const input = await readJson(req)
      if (ownerAccess) {
        const paths = rest === 'sign-upload' ? [input.path] : input.paths
        if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw fail(400, 'Provide 1 to 100 paths.')
        for (const path of paths) {
          objectKey(bucket, path)
          const [ownerId, puppyId, file, ...extra] = path.split('/')
          if (ownerId !== user.id || !/^\d+$/.test(puppyId) || !file || extra.length || !ownsSoldPuppy || !await ownsSoldPuppy(token, user, puppyId)) throw fail(403, 'You can only access photos for your sold puppy.')
        }
      }
      if (rest === 'sign-upload') {
        const key = objectKey(bucket, input.path)
        if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > 50 * 1024 * 1024) throw fail(400, 'Files must be 50 MB or smaller.')
        if (typeof input.contentType !== 'string' || !input.contentType || input.contentType.length > 200 || /[\r\n]/.test(input.contentType)) throw fail(400, 'Invalid content type.')
        if (bucket === 'owner-puppy-photos' && (input.size > 10 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(input.contentType))) throw fail(400, 'Upload a JPG, PNG or WebP photo up to 10 MB.')
        return json(200, { uploadUrl: await uploadUrl(key, input.contentType, input.size) })
      }
      if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 100) throw fail(400, 'Provide 1 to 100 paths.')
      const keys = input.paths.map(value => objectKey(bucket, value))
      if (rest === 'delete') { await remove(keys); return json(200, { deleted: input.paths.map(name => ({ name })) }) }
      const requested = Number(input.expiresIn ?? 600)
      if (!Number.isFinite(requested)) throw fail(400, 'Invalid expiry.')
      const expiry = Math.floor(Math.max(60, Math.min(3600, requested)))
      return json(200, { urls: await Promise.all(keys.map(async (key, i) => ({ path: input.paths[i], signedUrl: await readUrl(key, expiry) }))) })
    } catch (error) {
      return json(error.status || 500, { error: error.status ? error.message : 'File service request failed.' })
    }
  }
}
