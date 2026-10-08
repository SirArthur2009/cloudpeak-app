import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { database } from './settings.js'
import { railwayOwnerSchema } from './backend-db.js'

// Schema, fixtures, approvals and gallery writes all roll back together.
test('sold puppy ownership, private submissions and atomic moderation', async () => {
  const client = new pg.Client({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
  await client.connect()
  await client.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL lock_timeout='5s'")
    await client.query(railwayOwnerSchema())
    const owner = randomUUID(), other = randomUUID(), admin = randomUUID()
    for (const [id, role] of [[owner, 'client'], [other, 'client'], [admin, 'admin']]) {
      await client.query('INSERT INTO auth.users(id) VALUES($1)', [id])
      await client.query('INSERT INTO public.profiles(id,role) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role', [id, role])
    }
    const puppy = (await client.query("INSERT INTO public.puppies(name,status) VALUES('Original','available') RETURNING id")).rows[0].id
    let savepoint = 0
    async function denied(sql, args, pattern = /row-level security|permission denied/) {
      const label = `deny_${++savepoint}`
      await client.query(`SAVEPOINT ${label}`)
      await assert.rejects(client.query(sql, args), pattern)
      await client.query(`ROLLBACK TO SAVEPOINT ${label}`)
    }
    async function as(role, id, email) {
      await client.query('RESET ROLE')
      await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, email })])
      await client.query(`SET LOCAL ROLE ${role}`)
    }
    await denied("UPDATE public.puppies SET status='sold' WHERE id=$1", [puppy], /Reserve this puppy/)
    await client.query("UPDATE public.puppies SET status='reserved' WHERE id=$1", [puppy])
    await denied("UPDATE public.puppies SET status='sold' WHERE id=$1", [puppy], /approved family/)
    await client.query("INSERT INTO public.waitlist(name,email,selected_puppy_id,pending_approval) VALUES('Owner','owner@example.invalid',$1,false)", [puppy])
    await as('cloudpeak_user', owner, 'OWNER@example.invalid')
    await denied("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,requested_name) VALUES($1,$2,'name','New')", [puppy, owner])
    await as('cloudpeak_admin', admin, 'admin@example.invalid')
    await client.query("UPDATE public.puppies SET status='sold' WHERE id=$1", [puppy])
    await as('cloudpeak_user', other, 'other@example.invalid')
    await denied("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,requested_name) VALUES($1,$2,'name','Stolen')", [puppy, other])
    await as('cloudpeak_user', owner, 'OWNER@example.invalid')
    await denied("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,requested_name,status) VALUES($1,$2,'name','Auto','approved')", [puppy, owner])
    const name = (await client.query("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,requested_name) VALUES($1,$2,'name','New Name') RETURNING id", [puppy, owner])).rows[0].id
    await denied("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,requested_name) VALUES($1,$2,'name','Duplicate')", [puppy, owner], /unique constraint/)
    const path = `${owner}/${puppy}/photo.jpg`
    await denied("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,storage_path) VALUES($1,$2,'photo',$3)", [puppy, owner, `${other}/${puppy}/photo.jpg`], /check constraint/)
    const photo = (await client.query("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,storage_path) VALUES($1,$2,'photo',$3) RETURNING id", [puppy, owner, path])).rows[0].id
    assert.equal((await client.query("UPDATE public.puppy_owner_updates SET status='approved' WHERE id=$1 RETURNING id", [name])).rowCount, 0)
    assert.equal((await client.query('SELECT name FROM public.puppies WHERE id=$1', [puppy])).rows[0].name, 'Original')
    assert.equal((await client.query('SELECT * FROM public.puppy_photos WHERE puppy_id=$1', [puppy])).rowCount, 0)
    await as('cloudpeak_user', other, 'other@example.invalid')
    assert.equal((await client.query('SELECT * FROM public.puppy_owner_updates WHERE puppy_id=$1', [puppy])).rowCount, 0)
    await as('cloudpeak_anon', null, null)
    await denied('SELECT * FROM public.puppy_owner_updates')
    await as('cloudpeak_admin', admin, 'admin@example.invalid')
    await denied("UPDATE public.puppy_owner_updates SET requested_name='Edited' WHERE id=$1", [name], /cannot be changed/)
    await client.query("UPDATE public.puppy_owner_updates SET status='approved' WHERE id=$1", [name])
    assert.equal((await client.query('SELECT name FROM public.puppies WHERE id=$1', [puppy])).rows[0].name, 'New Name')
    await as('cloudpeak_user', owner, 'owner@example.invalid')
    const declined = (await client.query("INSERT INTO public.puppy_owner_updates(puppy_id,submitted_by,kind,requested_name) VALUES($1,$2,'name','Declined Name') RETURNING id", [puppy, owner])).rows[0].id
    await as('cloudpeak_admin', admin, 'admin@example.invalid')
    await client.query("UPDATE public.puppy_owner_updates SET status='rejected' WHERE id=$1", [declined])
    assert.equal((await client.query('SELECT name FROM public.puppies WHERE id=$1', [puppy])).rows[0].name, 'New Name')
    await denied("UPDATE public.puppy_owner_updates SET status='approved' WHERE id=$1", [photo], /null|check constraint/)
    await client.query("UPDATE public.puppy_owner_updates SET status='approved',published_url='https://example.invalid/photo.jpg' WHERE id=$1", [photo])
    assert.equal((await client.query('SELECT * FROM public.puppy_photos WHERE puppy_id=$1', [puppy])).rowCount, 1)
    await client.query("UPDATE public.puppy_owner_updates SET status='hidden' WHERE id=$1", [photo])
    assert.equal((await client.query('SELECT * FROM public.puppy_photos WHERE puppy_id=$1', [puppy])).rowCount, 0)
    await client.query("UPDATE public.puppy_owner_updates SET status='approved' WHERE id=$1", [photo])
    assert.equal((await client.query('SELECT * FROM public.puppy_photos WHERE puppy_id=$1', [puppy])).rowCount, 1)
    await client.query("UPDATE public.puppy_owner_updates SET status='rejected' WHERE id=$1", [photo])
    assert.equal((await client.query('SELECT * FROM public.puppy_photos WHERE puppy_id=$1', [puppy])).rowCount, 0)
  } finally { await client.query('ROLLBACK'); await client.end() }
})
