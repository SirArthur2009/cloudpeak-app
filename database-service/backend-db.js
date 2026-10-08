import { readFileSync } from 'node:fs'

export async function transaction(pool, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function installBackend(pool) {
  await transaction(pool, async client => {
    await client.query(readFileSync(new URL('./backend-schema.sql', import.meta.url), 'utf8'))
    await client.query(railwayOwnerSchema())
  })
}

export function railwayOwnerSchema() {
  return readFileSync(new URL('./owner-updates.sql', import.meta.url), 'utf8')
    .replace(/\banon\b/g, 'cloudpeak_anon').replace(/\bauthenticated\b/g, 'cloudpeak_user, cloudpeak_admin')
}

// Only call with a server-verified Auth user, never browser claims.
// User-editable metadata cannot assign roles. Existing Railway roles are preserved.
export async function syncVerifiedProfile(pool, user) {
  return transaction(pool, async client => {
    const removed = await client.query('SELECT 1 FROM cloudpeak_internal.deleted_accounts WHERE id=$1', [user.id])
    if (removed.rowCount) throw Object.assign(new Error('This account has been removed.'), { status: 403 })
    await client.query('INSERT INTO auth.users(id) VALUES($1) ON CONFLICT(id) DO NOTHING', [user.id])
    await client.query("INSERT INTO public.profiles(id,role) VALUES($1,'client') ON CONFLICT(id) DO NOTHING", [user.id])
    if (user.email) await client.query(`INSERT INTO cloudpeak_internal.user_directory(id,email,name,phone) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,phone=EXCLUDED.phone,updated_at=now()`,
    [user.id, user.email.toLowerCase(), String(user.user_metadata?.name || '').slice(0, 200), String(user.user_metadata?.phone || '').slice(0, 50)])
    const result = await client.query('SELECT role FROM public.profiles WHERE id=$1', [user.id])
    return result.rows[0].role === 'admin' ? 'cloudpeak_admin' : 'cloudpeak_user'
  })
}

export async function listAuthUsers(admin) {
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < 1000) return users
  }
}
