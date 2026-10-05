import { supabase } from '../src/lib/supabase.js'
import { storage, railwayStorageEnabled, uploadStorageFile } from '../src/lib/storage.js'

const base = (import.meta.env.VITE_STORAGE_API_URL || '').replace(/\/$/, '')
const output = document.querySelector('#output')
const run = document.querySelector('#run')
const cleanup = document.querySelector('#cleanup')
const sessionStatus = document.querySelector('#session')
const login = document.querySelector('#login')
let uploadedPath = null
document.querySelector('#configuration').textContent = railwayStorageEnabled ? `Signer: ${base}` : 'Supabase storage mode. Restart with npm run dev:storage to test Railway.'
run.disabled = !railwayStorageEnabled
const log = message => { output.textContent += `\n${message}` }
async function refreshSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) { sessionStatus.textContent = `Sign-in check failed: ${error.message}`; return }
  if (!session) {
    sessionStatus.textContent = `Not signed in at ${location.origin}. Sign in here; localhost and 127.0.0.1 have separate sessions.`
    login.hidden = false
    return
  }
  const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
  sessionStatus.textContent = profileError ? `Signed in as ${session.user.email}; role check failed: ${profileError.message}`
    : `Signed in as ${session.user.email} (${profile?.role || 'no role'}).`
  login.hidden = !profileError && profile?.role === 'admin'
}
login.addEventListener('submit', async event => {
  event.preventDefault()
  const button = document.querySelector('#signin')
  button.disabled = true
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: document.querySelector('#email').value.trim(), password: document.querySelector('#password').value })
    if (error) throw error
    document.querySelector('#password').value = ''
    await refreshSession()
  } catch (error) { sessionStatus.textContent = `Sign-in failed: ${error.message}` }
  finally { button.disabled = false }
})
refreshSession().catch(error => { sessionStatus.textContent = `Sign-in check failed: ${error.message}` })
async function signerFetch(path, options) {
  try { return await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(15000) }) }
  catch { throw new Error(`Cannot reach the local signer at ${base}. Keep npm run dev:all:storage running and reload this page.`) }
}
async function digest(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('')
}
run.addEventListener('click', async () => {
  run.disabled = true; output.textContent = 'Starting…'
  let stage = 'Sign-in check'
  try {
    if (uploadedPath) throw new Error('Delete the previous test file before running another test.')
    const file = document.querySelector('#file').files[0]
    if (!file) throw new Error('Choose a file first.')
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose a file below 50 MB.')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error(`Sign in using the form on this page (${location.origin}).`)
    stage = 'Signer connection'
    const denied = await signerFetch('/api/admin-files/sign-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: ['secret'] }) })
    if (denied.status !== 401) throw new Error('Unauthenticated private-file access was not denied.')
    log('PASS: unauthenticated private access denied.')
    const publicPrivate = await signerFetch('/public/admin-files/secret')
    if (publicPrivate.status !== 404) throw new Error('Private prefix was accessible through the public route.')
    log('PASS: private files have no public route.')
    const path = `storage-tests/${crypto.randomUUID()}`
    stage = 'Upload authorization / Railway upload'
    await uploadStorageFile('admin-files', path, file, { onProgress: loaded => { output.textContent = `Uploading ${loaded} / ${file.size} bytes…` } })
    uploadedPath = path; cleanup.disabled = false
    stage = 'Download authorization / Railway download'
    const { data, error } = await storage.from('admin-files').download(path)
    if (error) throw error
    if (await digest(data) !== await digest(file)) throw new Error('Download checksum does not match the selected file.')
    log('PASS: uploaded and downloaded bytes match (SHA-256).')
    log('Use Delete test file to clean up this object. Database records were not changed.')
  } catch (error) { log(`FAILED (${stage}): ${error.message}`) }
  finally { run.disabled = false }
})
cleanup.addEventListener('click', async () => {
  cleanup.disabled = true
  try {
    const { error } = await storage.from('admin-files').remove([uploadedPath])
    if (error) throw error
    uploadedPath = null; log('Test file deleted.')
  } catch (error) { cleanup.disabled = false; log(`Cleanup failed: ${error.message}`) }
})
