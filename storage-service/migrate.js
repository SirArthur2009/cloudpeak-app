import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { clients } from './clients.js'
import { buckets, publicBuckets, objectKey } from './policy.js'

const mode = process.argv[2] || '--plan'
const concurrency = Number(process.env.STORAGE_COPY_CONCURRENCY || 4)
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('STORAGE_COPY_CONCURRENCY must be between 1 and 8.')
if (!['--plan', '--copy', '--rewrite'].includes(mode)) throw new Error('Use --plan, --copy, or --rewrite.')
const { s3, bucket: Bucket } = clients()
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required locally for migration.')
const source = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const base = (process.env.STORAGE_PUBLIC_URL || '').replace(/\/$/, '')
const manifestFile = new URL('./migration-manifest.json', import.meta.url)
const backupFile = new URL('./url-backup.json', import.meta.url)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
let pendingSave = Promise.resolve()
const save = value => {
  const snapshot = JSON.stringify(value, null, 2)
  pendingSave = pendingSave.then(async () => {
    const temporary = new URL('./migration-manifest.json.tmp', import.meta.url)
    await writeFile(temporary, snapshot)
    await rename(temporary, manifestFile)
  })
  return pendingSave
}
let manifest
try { manifest = JSON.parse(await readFile(manifestFile, 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { source: process.env.SUPABASE_URL, destination: Bucket, objects: {} } }
if (manifest.source !== process.env.SUPABASE_URL || manifest.destination !== Bucket) throw new Error('Manifest belongs to another source or destination.')

const objects = []
async function sourceRequest(operation) {
  for (let attempt = 0; ; attempt++) {
    let result
    try { result = await operation() }
    catch (error) { result = { error } }
    if (!result.error) return result
    const status = result.error.statusCode || result.error.status
    if (attempt >= 4 || (status && status !== 429 && status < 500)) throw result.error
    console.log(`Retrying temporary source request failure (${attempt + 1}/4).`)
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)))
  }
}
async function list(bucket, folder = '') {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sourceRequest(() => source.storage.from(bucket).list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }))
    if (error) throw error
    for (const entry of data) {
      const path = folder ? `${folder}/${entry.name}` : entry.name
      if (!entry.id && !entry.metadata) await list(bucket, path)
      else objects.push({ bucket, path, metadata: entry.metadata, updatedAt: entry.updated_at })
    }
    if (data.length < 100) break
  }
}
for (const bucket of buckets) await list(bucket)
console.log(`${objects.length} source objects, ${objects.reduce((sum, item) => sum + Number(item.metadata?.size || 0), 0)} bytes.`)
if (mode === '--plan') process.exit(0)

async function verified(item) {
  const Key = objectKey(item.bucket, item.path)
  const record = manifest.objects[Key]
  if (!record || record.updatedAt !== item.updatedAt || record.size !== Number(item.metadata?.size)) return false
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key }))
    return head.ContentLength === record.size && head.Metadata?.sha256 === record.sha256
  } catch (error) { if (error.$metadata?.httpStatusCode === 404) return false; throw error }
}

if (mode === '--copy') {
  let completed = 0
  async function copyObject(item) {
    const Key = objectKey(item.bucket, item.path)
    if (await verified(item)) { console.log(`${++completed}/${objects.length}: verified existing copy`); return }
    const { data, error } = await sourceRequest(() => source.storage.from(item.bucket).download(item.path))
    if (error) throw error
    const bytes = Buffer.from(await data.arrayBuffer())
    if (bytes.length !== Number(item.metadata?.size)) throw new Error(`Source size changed: ${Key}. Rerun the copy.`)
    const sha256 = digest(bytes)
    await s3.send(new PutObjectCommand({ Bucket, Key, Body: bytes, ContentType: item.metadata?.mimetype || data.type || 'application/octet-stream', Metadata: { sha256 }, CacheControl: publicBuckets.has(item.bucket) ? 'public, max-age=3600' : 'private, no-store' }))
    const downloaded = await s3.send(new GetObjectCommand({ Bucket, Key }))
    if (digest(await downloaded.Body.transformToByteArray()) !== sha256) throw new Error(`Checksum mismatch: ${Key}`)
    manifest.objects[Key] = { sha256, size: bytes.length, updatedAt: item.updatedAt }
    await save(manifest)
    console.log(`${++completed}/${objects.length}: copied and verified (${bytes.length} bytes)`)
  }
  let cursor = 0
  let failure
  // Limit concurrent files to keep memory bounded. Manifest writes serialize.
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!failure && cursor < objects.length) {
      const item = objects[cursor++]
      for (let attempt = 0; ; attempt++) {
        try { await copyObject(item); break }
        catch (error) {
          const temporary = /fetch failed|terminated|ECONNRESET|ETIMEDOUT|socket|timeout/i.test(`${error.message} ${error.code} ${error.cause?.code}`)
          if (!temporary || attempt >= 4) { failure = error; break }
          console.log(`Retrying interrupted file transfer (${attempt + 1}/4).`)
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)))
        }
      }
    }
  }))
  if (failure) throw failure
  // Only written after all copies have been read back and checked.
  manifest.copiedAt = new Date().toISOString()
  await save(manifest)
  await s3.send(new PutObjectCommand({ Bucket, Key: '_migration/ready.json', Body: JSON.stringify({ copiedAt: manifest.copiedAt, count: objects.length }), ContentType: 'application/json' }))
  console.log('Copy verified. Originals remain in Supabase. Deploy the service and frontend before --rewrite.')
  process.exit(0)
}

if (!base || new URL(base).protocol !== 'https:') throw new Error('Set STORAGE_PUBLIC_URL to the deployed HTTPS service URL.')
for (const item of objects) if (!await verified(item)) throw new Error('Source has unverified files. Run --copy again before rewriting URLs.')
const health = await fetch(`${base}/health`)
if (!health.ok) throw new Error('Destination file service is not healthy.')
const legacy = new URL(process.env.SUPABASE_URL)
function replacement(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const marker = '/storage/v1/object/public/'
    if (url.origin !== legacy.origin || !url.pathname.startsWith(marker)) return null
    const [bucket, ...parts] = url.pathname.slice(marker.length).split('/').map(decodeURIComponent)
    const path = parts.join('/')
    if (!publicBuckets.has(bucket) || !manifest.objects[objectKey(bucket, path)]) throw new Error('Referenced file was not copied.')
    return `${base}/public/${bucket}/${parts.map(encodeURIComponent).join('/')}`
  } catch (error) { if (error.message === 'Referenced file was not copied.') throw error; return null }
}

const changes = []
for (const [table, columns] of [['dogs', ['photo_url', 'pedigree_url', 'embark_url', 'ofa_url']], ['puppies', ['photo_url']], ['puppy_photos', ['photo_url']]]) {
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await source.from(table).select(['id', ...columns].join(',')).order('id').range(offset, offset + 499)
    if (error) throw error
    for (const row of data) for (const column of columns) {
      const next = replacement(row[column])
      if (next) changes.push({ table, id: row.id, column, previous: row[column], next })
    }
    if (data.length < 500) break
  }
}
// Save every original URL before any database write. Preserve prior runs too.
let backup = []
try { backup = JSON.parse(await readFile(backupFile, 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
backup.push(...changes)
await writeFile(backupFile, JSON.stringify(backup, null, 2))
for (const change of changes) {
  const response = await fetch(change.next, { redirect: 'follow', headers: { Range: 'bytes=0-0' } })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`Destination link failed for ${change.table}/${change.id}.`)
  const { data, error } = await source.from(change.table).update({ [change.column]: change.next }).eq('id', change.id).eq(change.column, change.previous).select('id')
  if (error || data?.length !== 1) throw error || new Error('A record changed during migration. Rerun to reassess.')
}
console.log(`Updated ${changes.length} links. Originals remain in Supabase; no source files were deleted.`)
