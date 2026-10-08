import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { compare } from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { transaction } from './backend-db.js'

export function legacyUser(user) {
  return user && { ...user, user_metadata: { name: user.name, phone: user.phone }, app_metadata: { must_change_password: user.mustChangePassword } }
}

export function createBetterAuth(pool, env) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('Set a server-only BETTER_AUTH_SECRET of at least 32 characters.')
  if (!env.BETTER_AUTH_URL) throw new Error('Set BETTER_AUTH_URL to the public auth endpoint base URL.')
  return betterAuth({
    database: pool,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
    advanced: {
      database: { generateId: () => randomUUID() },
      ipAddress: { ipAddressHeaders: ['x-cloudpeak-client-ip'] },
    },
    emailAndPassword: {
      enabled: true, disableSignUp: true, minPasswordLength: 8,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => /^\$2[aby]\$/.test(hash) ? compare(password, hash.replace(/^\$2y\$/, '$2b$')) : verifyPassword({ hash, password }),
      },
    },
    user: { additionalFields: {
      phone: { type: 'string', required: false, input: false },
      mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
    } },
    session: { cookieCache: { enabled: false } },
    plugins: [bearer()],
  })
}

// Called only by the existing server actions, after their role and allowlist checks.
export function createBetterAuthAdmin(pool) {
  const run = async work => {
    try { return { data: await work(), error: null } }
    catch (error) { return { data: null, error } }
  }
  async function save(id, payload, create = false) {
    const password = payload.password ? await hashPassword(payload.password) : null
    return transaction(pool, async client => {
      if (create) await client.query(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",phone,"mustChangePassword")
        VALUES($1,$2,$3,true,now(),now(),$4,$5)`, [id, payload.user_metadata?.name || '', payload.email.toLowerCase(), payload.user_metadata?.phone || '', Boolean(payload.app_metadata?.must_change_password)])
      else await client.query(`UPDATE "user" SET name=COALESCE($2,name),phone=COALESCE($3,phone),"mustChangePassword"=COALESCE($4,"mustChangePassword"),"updatedAt"=now() WHERE id=$1`,
        [id, payload.user_metadata?.name ?? null, payload.user_metadata?.phone ?? null, payload.app_metadata?.must_change_password ?? null])
      if (password) {
        await client.query(`INSERT INTO account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,'credential',$2,$3,now(),now())
          ON CONFLICT ("providerId","accountId") DO UPDATE SET password=EXCLUDED.password,"updatedAt"=now()`, [randomUUID(), id, password])
        await client.query('DELETE FROM session WHERE "userId"=$1', [id])
      }
      const { rows } = await client.query('SELECT * FROM "user" WHERE id=$1', [id])
      if (!rows[0]) throw new Error('Account does not exist.')
      return { user: legacyUser(rows[0]) }
    })
  }
  return {
    listUsers: ({ page, perPage }) => run(async () => ({ users: (await pool.query('SELECT * FROM "user" ORDER BY id LIMIT $1 OFFSET $2', [perPage, (page - 1) * perPage])).rows.map(legacyUser) })),
    createUser: payload => run(() => save(randomUUID(), payload, true)),
    updateUserById: (id, payload) => run(() => save(id, payload)),
    deleteUser: id => run(async () => { await pool.query('DELETE FROM "user" WHERE id=$1', [id]); return {} }),
  }
}
