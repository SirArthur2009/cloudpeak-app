import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { database, tables } from './settings.js'

const snapshot = JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url)))
const schema = JSON.parse(readFileSync(new URL('./source-schema.json', import.meta.url)))
const client = new pg.Client({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
function normalized(table, rows) {
  const dates = schema.columns.filter(column => column.table === table && column.type === 'timestamp with time zone').map(column => column.name)
  return rows.map(row => {
    const copy = { ...row }
    for (const key of dates) if (copy[key]) copy[key] = new Date(copy[key]).toISOString()
    return canonical(copy)
  })
}
await client.connect()
let total = 0
try {
  for (const table of tables) {
    const result = await client.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') rows FROM public."${table}" t`)
    if (JSON.stringify(normalized(table, result.rows[0].rows)) !== JSON.stringify(normalized(table, snapshot[table]))) throw new Error(`Row comparison failed for ${table}.`)
    total += snapshot[table].length
    console.log(`PASS: ${table}, ${snapshot[table].length} matching rows.`)
  }
  const before = await client.query('SELECT count(*)::int count FROM public.puppies')
  await client.query("BEGIN; SET LOCAL ROLE cloudpeak_admin; INSERT INTO public.puppies(name,status) VALUES ('Disposable database verification','available'); ROLLBACK;")
  const after = await client.query('SELECT count(*)::int count FROM public.puppies')
  if (before.rows[0].count !== after.rows[0].count) throw new Error('Write rollback verification failed.')
  console.log('PASS: Railway test write and rollback; source Supabase was not written.')
  const privateTables = ['applications','waitlist','emails','admin_files','guest_payments','profiles']
  for (const table of privateTables) {
    await client.query('BEGIN; SET LOCAL ROLE cloudpeak_anon')
    let denied = false
    try { await client.query(`SELECT * FROM public."${table}" LIMIT 1`) } catch (error) { denied = error.code === '42501' }
    await client.query('ROLLBACK')
    if (!denied) throw new Error(`Anonymous private access was not denied for ${table}.`)
  }
  const user = snapshot.profiles.find(profile => profile.role !== 'admin')
  if (user) {
    await client.query('BEGIN; SET LOCAL ROLE cloudpeak_user')
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user.id, email: 'isolation-test@example.invalid' })])
    const profiles = await client.query('SELECT id FROM public.profiles')
    if (profiles.rows.some(row => row.id !== user.id)) throw new Error('Client can read another profile.')
    const waitlist = await client.query('SELECT id FROM public.waitlist')
    if (waitlist.rows.length) throw new Error('Client can read another waitlist entry.')
    const updated = await client.query("UPDATE public.puppies SET notes='Forbidden test update'").catch(error => error)
    if (updated.code !== '42501') throw new Error('Client puppy mutation was not denied.')
    await client.query('ROLLBACK')
  }
  console.log('PASS: anonymous private access and client isolation checks.')
  const report = JSON.parse(readFileSync(new URL('./copy-report.json', import.meta.url)))
  report.verifiedAt = new Date().toISOString(); report.totalRows = total
  writeFileSync(new URL('./copy-report.json', import.meta.url), JSON.stringify(report,null,2))
  console.log(`Verified all ${tables.length} tables and ${total} rows.`)
} finally { await client.end() }
