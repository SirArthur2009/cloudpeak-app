import { readFileSync } from 'node:fs'
import pg from 'pg'
import { app, database } from './settings.js'

const manifest = JSON.parse(readFileSync(new URL('../storage-service/migration-manifest.json', import.meta.url)))
const client = new pg.Client({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
await client.connect()
let changed = 0
try {
  await client.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  await client.query('BEGIN')
  for (const [table, columns] of [['puppies',['photo_url']],['puppy_photos',['photo_url']],['dogs',['photo_url','pedigree_url','embark_url','ofa_url']]]) {
    const { rows } = await client.query(`SELECT * FROM public."${table}"`)
    for (const row of rows) for (const column of columns) {
      if (!row[column]) continue
      const url = new URL(row[column])
      const prefix = '/storage/v1/object/public/'
      if (url.origin !== new URL(app.VITE_SUPABASE_URL).origin || !url.pathname.startsWith(prefix)) continue
      const key = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/')
      if (!manifest.objects[key]) throw new Error('Referenced source file was not verified in Railway; rerun the storage copy first.')
      const next = `${app.VITE_SUPABASE_URL}/functions/v1/storage-files/public/${key.split('/').map(encodeURIComponent).join('/')}`
      await client.query(`UPDATE public."${table}" SET "${column}"=$1 WHERE id=$2`, [next,row.id]); changed++
    }
  }
  await client.query('COMMIT')
  console.log(`Updated ${changed} file links in the Railway test copy only. Live Supabase URLs are unchanged.`)
} catch (error) { await client.query('ROLLBACK'); throw error } finally { await client.end() }
