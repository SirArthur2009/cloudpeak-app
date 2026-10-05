import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const base = 'https://bvnurkvvhlmdapvhvcje.supabase.co/functions/v1/storage-files'
for (const [path, method, expected] of [['/public/admin-files/test', 'GET', 404], ['/api/admin-files/sign-read', 'POST', 401]]) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ path: 'test' }) } : {}) })
  if (response.status !== expected) throw new Error(`${path}: expected ${expected}, received ${response.status}: ${await response.text()}`)
  console.log(`PASS: ${path} denies anonymous access (${expected}).`)
}
const manifest = JSON.parse(await readFile(new URL('../storage-service/migration-manifest.json', import.meta.url), 'utf8'))
const entry = Object.entries(manifest.objects).find(([key]) => key.startsWith('puppy-photos/') || key.startsWith('dog-photos/'))
if (entry) {
  const [key, record] = entry
  const response = await fetch(`${base}/public/${key.split('/').map(encodeURIComponent).join('/')}`)
  if (!response.ok) throw new Error(`Public download returned ${response.status}: ${await response.text()}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Public redirect checksum mismatch.')
  console.log(`PASS: deployed public redirect downloaded ${bytes.length} matching bytes from Railway.`)
} else console.log('Public photo verification pending until a photo is copied.')
const health = await fetch(`${base}/health`)
console.log(`Readiness: ${health.status} ${await health.text()}`)
if (manifest.copiedAt && !health.ok) throw new Error('Completed copy is not healthy.')
