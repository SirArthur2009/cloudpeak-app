import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { app, database, tables } from './settings.js'
import { normalize } from './reconciliation-values.js'

// Calendar dates must not become midnight in this computer's local timezone.
pg.types.setTypeParser(1082, value => value)

const source = createClient(app.VITE_SUPABASE_URL,database.SUPABASE_SERVICE_ROLE_KEY || app.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const db = new pg.Client({connectionString:database.DATABASE_URL,ssl:{ca:await readFile(new URL('./database-ca.pem',import.meta.url)),checkServerIdentity:()=>undefined}})
const schema = JSON.parse(await readFile(new URL('./source-schema.json',import.meta.url),'utf8'))
const digest = (table,row) => createHash('sha256').update(JSON.stringify(Object.fromEntries(schema.columns.filter(c=>c.table===table).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>[c.name,normalize(row[c.name],c)])))).digest('hex')
const sourceRows={}, railwayRows={}, comparison=[]
await db.connect()
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  for (const table of tables) {
    sourceRows[table]=[]
    for (let offset=0;;offset+=500) {
      const {data,error}=await source.from(table).select('*').order('id').range(offset,offset+499)
      if (error) throw new Error(`Source read failed for ${table}.`)
      sourceRows[table].push(...data)
      if (data.length<500) break
    }
    railwayRows[table]=(await db.query(`SELECT * FROM public."${table}" ORDER BY id`)).rows
    const original=new Map(sourceRows[table].map(row=>[String(row.id),digest(table,row)]))
    const copy=new Map(railwayRows[table].map(row=>[String(row.id),digest(table,row)]))
    comparison.push({table,source:original.size,railway:copy.size,sourceOnly:[...original.keys()].filter(id=>!copy.has(id)),railwayOnly:[...copy.keys()].filter(id=>!original.has(id)),changed:[...original.keys()].filter(id=>copy.has(id)&&copy.get(id)!==original.get(id))})
  }
  await db.query('COMMIT')
} finally { await db.end() }
const directory=new URL(`./reconciliation/${new Date().toISOString().replace(/[:.]/g,'-')}/`,import.meta.url)
await mkdir(directory,{recursive:true})
await writeFile(new URL('supabase-latest.json',directory),JSON.stringify(sourceRows))
await writeFile(new URL('railway-before-refresh.json',directory),JSON.stringify(railwayRows))
await writeFile(new URL('review.json',directory),JSON.stringify({createdAt:new Date().toISOString(),readOnly:true,comparison},null,2))
console.log(JSON.stringify({readOnly:true,tables:comparison.map(({table,source,railway,sourceOnly,railwayOnly,changed})=>({table,source,railway,sourceOnly:sourceOnly.length,railwayOnly:railwayOnly.length,changed:changed.length})),privateBackupDirectory:directory.pathname},null,2))
