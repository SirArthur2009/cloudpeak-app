import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { database } from './settings.js'
import { transaction, syncVerifiedProfile } from './backend-db.js'

// Export id,email,encrypted_password,email_confirmed_at,raw_user_meta_data,
// raw_app_meta_data,created_at from Supabase auth.users using a trusted SQL client.
// Treat that JSON file as a secret; never commit it or include it in a release.
const path = process.argv[2]
if (!path) throw new Error('Usage: node migrate-better-auth.js <private-supabase-users.json> [--apply]. Default is validation only.')
const users = JSON.parse(readFileSync(path, 'utf8'))
if (!Array.isArray(users) || !users.length) throw new Error('Expected a nonempty JSON array of exported users.')
const ids = new Set(), emails = new Set()
for (const user of users) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id || '')) throw new Error('An exported user has an invalid UUID.')
  if (!user.email || !user.email_confirmed_at || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.encrypted_password || '')) throw new Error('Every account needs a confirmed email and bcrypt password hash. Review unsupported accounts separately.')
  const email = user.email.trim().toLowerCase()
  if (ids.has(user.id) || emails.has(email)) throw new Error('Duplicate exported identity.')
  ids.add(user.id); emails.add(email)
}
if (!process.argv.includes('--apply')) {
  console.log(`Validated ${users.length} password-preserving imports. No database changes made.`)
} else {
  const pool = new pg.Pool({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined }, max: 2 })
  try {
    await transaction(pool, async client => {
      await client.query(readFileSync(new URL('./better-auth-schema.sql', import.meta.url), 'utf8'))
      for (const user of users) {
        const metadata = user.raw_user_meta_data || {}, appMetadata = user.raw_app_meta_data || {}
        // Fail on conflicting identities; do not overwrite a password changed after import.
        await client.query(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",phone,"mustChangePassword")
          VALUES($1,$2,$3,true,$4,now(),$5,$6) ON CONFLICT(id) DO NOTHING`,
        [user.id, String(metadata.name || ''), user.email.trim().toLowerCase(), user.created_at || new Date(), String(metadata.phone || ''), Boolean(appMetadata.must_change_password)])
        const existing = await client.query('SELECT email FROM "user" WHERE id=$1', [user.id])
        if (existing.rows[0].email !== user.email.trim().toLowerCase()) throw new Error('An existing identity has a different email; import stopped.')
        await client.query(`INSERT INTO account (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
          VALUES($1,$2,'credential',$2,$3,now(),now()) ON CONFLICT("providerId","accountId") DO NOTHING`, [randomUUID(), user.id, user.encrypted_password])
      }
    })
    for (const user of users) await syncVerifiedProfile(pool, { id: user.id, email: user.email, user_metadata: user.raw_user_meta_data })
    console.log(`Imported ${users.length} accounts with original IDs and password hashes. Existing profile roles preserved. No Supabase writes.`)
  } finally { await pool.end() }
}
