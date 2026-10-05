import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { clients } from '../storage-service/clients.js'

const require = createRequire(new URL('../storage-service/package.json',import.meta.url))
const { GetObjectCommand, DeleteObjectsCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const pg = createRequire(new URL('../database-service/package.json',import.meta.url))('pg')
const database = parseEnv(await readFile(new URL('../database-service/.env',import.meta.url),'utf8'))
const storageEnv = parseEnv(await readFile(new URL('../storage-service/.env',import.meta.url),'utf8'))
const {s3,bucket:Bucket} = clients(storageEnv)
const db = new pg.Client({connectionString:database.DATABASE_URL,ssl:{ca:await readFile(new URL('../database-service/database-ca.pem',import.meta.url)),checkServerIdentity:()=>undefined}})
const names=['cloudpeak-hosted-disposable-test.txt','cloudpeak-hosted-disposable-test.png']
const hash = data => createHash('sha256').update(data).digest('hex')
await db.connect()
try {
  await db.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  const {rows} = await db.query("SELECT id,name,storage_path FROM public.admin_files WHERE name=ANY($1::text[]) AND created_at >= '2026-10-02T18:29:00Z'",[names])
  if (rows.length !== 2 || new Set(rows.map(row=>row.name)).size !== 2) throw new Error('Expected exactly the two disposable hosted uploads; refusing cleanup.')
  for (const row of rows) {
    if (!/^[0-9a-f-]{36}$/.test(row.storage_path)) throw new Error('Unexpected test object path; refusing cleanup.')
    const local = await readFile(`C:/Users/levig/.codex/visualizations/2026/10/01/01a0f866-50f4-7070-8a1a-c4970f17752d/${row.name}`)
    const result = await s3.send(new GetObjectCommand({Bucket,Key:`admin-files/${row.storage_path}`}))
    const downloaded = await result.Body.transformToByteArray()
    if (hash(local)!==hash(downloaded)) throw new Error('Uploaded bytes did not match.')
  }
  console.log('PASS: both hosted uploads match their source bytes (SHA-256).')
  if (process.argv.includes('--cleanup')) {
    const result = await s3.send(new DeleteObjectsCommand({Bucket,Delete:{Objects:rows.map(row=>({Key:`admin-files/${row.storage_path}`}))}}))
    if (result.Errors?.length) throw new Error('Test object cleanup failed; database rows retained.')
    for (const row of rows) {
      try { await s3.send(new HeadObjectCommand({Bucket,Key:`admin-files/${row.storage_path}`})); throw new Error('Object still exists.') }
      catch(error) { if (error.$metadata?.httpStatusCode!==404) throw error }
    }
    await db.query('DELETE FROM public.admin_files WHERE id::text=ANY($1::text[]) AND name=ANY($2::text[])',[rows.map(row=>String(row.id)),names])
    console.log('Removed only the two newly created disposable test objects and their Railway test records.')
  }
} finally { await db.end() }
