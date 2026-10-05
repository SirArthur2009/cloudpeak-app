import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'
import { clients } from './clients.js'
import { createStorageHandler } from '../supabase/functions/storage-files/handler.js'

export function createStorageServer(env = process.env) {
  const { s3, bucket: Bucket, auth, supabaseUrl, anonKey } = clients(env)
  const handler = createStorageHandler({
    origins: new Set((env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)),
    async getUser(token) { const { data, error } = await auth.auth.getUser(token); return error ? null : data.user },
    async getRole(token, id) {
      if (env.DATA_API_URL) {
        const response = await fetch(`${env.DATA_API_URL.replace(/\/$/, '')}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) return null
        const rows = await response.json()
        return rows[0]?.role || null
      }
      const user = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
      const { data, error } = await user.from('profiles').select('role').eq('id', id).single()
      return error ? null : data?.role
    },
    readUrl: (Key, expiresIn) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn }),
    uploadUrl: (Key, ContentType, ContentLength) => getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength, IfNoneMatch: '*' }), { expiresIn: 600 }),
    async remove(keys) {
      const result = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map(Key => ({ Key })) } }))
      if (result.Errors?.length) throw new Error('Some files could not be deleted.')
    },
    async health() { await s3.send(new HeadObjectCommand({ Bucket, Key: '_migration/ready.json' })) },
  })
  return createServer(async (req, res) => {
    try {
      const init = { method: req.method, headers: req.headers }
      if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half' }
      const response = await handler(new Request(`http://localhost${req.url}`, init))
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Local storage request failed.' }))
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001)
  createStorageServer().listen(port, '127.0.0.1', () => console.log(`Storage signer: http://localhost:${port}/functions/v1/storage-files`))
}
