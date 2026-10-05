// Three-way merge of the reviewed source-only changes. Never deletes Railway data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { database } from './settings.js'
import { normalize } from './reconciliation-values.js'

const baselineDirectory = new URL('./reconciliation/2026-10-02T18-47-11-885Z/', import.meta.url)
const latestDirectory = new URL('./reconciliation/2026-10-05T20-16-33-507Z/', import.meta.url)
const json = async url => JSON.parse(await readFile(url, 'utf8'))
const baseline = await json(new URL('supabase-latest.json', baselineDirectory))
const source = await json(new URL('supabase-latest.json', latestDirectory))
const snapshot = await json(new URL('railway-before-refresh.json', latestDirectory))
const schema = await json(new URL('./source-schema.json', import.meta.url))
const db = new pg.Client({ connectionString: database.DATABASE_URL, ssl: { ca: await readFile(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
pg.types.setTypeParser(1082, value => value)
const equal = (a, b, column) => JSON.stringify(normalize(a, column)) === JSON.stringify(normalize(b, column))
const changes = []
await db.connect()
try {
  await db.query('BEGIN')
  await db.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  for (const table of ['dogs', 'applications', 'emails']) {
    const columns = schema.columns.filter(column => column.table === table)
    for (const row of source[table]) {
      const old = baseline[table].find(item => String(item.id) === String(row.id))
      const copied = snapshot[table].find(item => String(item.id) === String(row.id))
      const current = (await db.query(`SELECT * FROM public."${table}" WHERE id=$1 FOR UPDATE`, [row.id])).rows[0]
      if (!old) {
        if (current) { assert.ok(columns.every(column => equal(current[column.name], row[column.name], column)), 'New source record conflicts with a Railway record.'); continue }
        const names = columns.map(column => column.name)
        await db.query(`INSERT INTO public."${table}" (${names.map(name => `"${name}"`).join(',')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(',')})`, names.map(name => row[name]))
        changes.push({ table, operation: 'insert' })
      } else {
        const changed = columns.filter(column => !equal(old[column.name], row[column.name], column))
        if (!changed.length) continue
        assert.ok(current && copied, 'Updated source row is missing from Railway.')
        for (const column of changed) {
          assert.ok(equal(current[column.name], copied[column.name], column), 'Railway changed after review.')
          assert.ok(equal(current[column.name], old[column.name], column), 'Source update conflicts with a Railway edit.')
        }
        await db.query(`UPDATE public."${table}" SET ${changed.map((column, index) => `"${column.name}"=$${index + 2}`).join(',')} WHERE id=$1`, [row.id, ...changed.map(column => row[column.name])])
        changes.push({ table, operation: 'update', fields: changed.map(column => column.name) })
      }
    }
  }
  await db.query('COMMIT')
  console.log(JSON.stringify({ reviewedChangesApplied: changes, railwayOnlyDataPreserved: true }))
} catch (error) { await db.query('ROLLBACK'); throw error } finally { await db.end() }
