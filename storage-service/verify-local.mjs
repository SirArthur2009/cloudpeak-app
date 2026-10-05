import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createHash, randomUUID } from 'node:crypto'
import { clients } from './clients.js'

const { s3, bucket: Bucket } = clients()
const base = (process.env.STORAGE_VERIFY_URL || 'http://127.0.0.1:3001/functions/v1/storage-files').replace(/\/$/, '')
const path = `storage-tests/${randomUUID()}.txt`
const Key = `puppy-photos/${path}`
const data = Buffer.from('Cloudpeak local storage verification\n')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  await s3.send(new PutObjectCommand({ Bucket, Key, Body: data, ContentType: 'text/plain' }))
  const direct = await s3.send(new GetObjectCommand({ Bucket, Key }))
  if (hash(await direct.Body.transformToByteArray()) !== hash(data)) throw new Error('Direct bucket checksum failed.')
  const response = await fetch(`${base}/public/puppy-photos/${path}`, { headers: { Origin: 'http://localhost:5173' } })
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(data)) throw new Error(`Signer redirect checksum failed (${response.status}).`)
  const denied = await fetch(`${base}/api/admin-files/sign-read`, { method: 'POST', body: JSON.stringify({ paths: ['secret'] }) })
  if (denied.status !== 401) throw new Error('Unauthenticated private access was not denied.')
  console.log('PASS: Railway upload, download hash, function redirect, and private access denial.')
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket, Key }))
  console.log('Deleted only the test object created by this verification.')
}
