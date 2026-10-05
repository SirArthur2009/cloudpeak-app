import assert from 'node:assert/strict'
const base = process.env.DATA_API_URL || 'http://127.0.0.1:3002'
const health = await fetch(`${base}/health`)
assert.equal(health.status,200)
assert.equal((await health.json()).database,'Railway test copy')
const puppies = await fetch(`${base}/rest/v1/puppies?select=id,photo_url,litters(name)`,{headers:{Prefer:'count=exact'}})
assert.equal(puppies.status,200)
const rows=await puppies.json()
assert.equal(rows.length,20)
assert.ok(rows.some(row=>row.litters?.name))
assert.ok(rows.some(row=>row.photo_url?.includes('/functions/v1/storage-files/public/')))
for(const table of ['emails','applications','admin_files','guest_payments','profiles']) {
  const result=await fetch(`${base}/rest/v1/${table}?select=id`)
  assert.equal(result.status,401)
}
assert.equal((await fetch(`${base}/rest/v1/profiles?select=id`,{headers:{Authorization:'Bearer forged'}})).status,401)
assert.equal((await fetch(`${base}/rest/v1/puppies`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Forbidden mutation'})})).status,401)
assert.equal((await fetch(`${base}/functions/v1/send-reservation-email`,{method:'POST'})).status,401)
assert.equal((await fetch(`${base}/health`,{headers:{Origin:'https://unapproved.example'}})).status,403)
console.log('PASS: Railway API health, 20 puppy records, relational queries, Railway photo links, private-access denial, forged-session denial, mutation denial, origin checks, and authenticated email actions.')
