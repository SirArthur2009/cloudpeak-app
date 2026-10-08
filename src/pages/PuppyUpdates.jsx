import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { storage, uploadStorageFile } from '../lib/storage'

const button = { padding: '0.55rem 0.9rem', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' }
const field = { padding: '0.65rem', border: '1px solid #ddd', borderRadius: 6, fontSize: 16, width: '100%' }
const card = { padding: 20, border: '1px solid #ddd', borderRadius: 10, marginBottom: 16, background: '#fff' }

export default function PuppyUpdates({ admin = false }) {
  const [puppies, setPuppies] = useState([])
  const [updates, setUpdates] = useState([])
  const [previews, setPreviews] = useState({})
  const [names, setNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('pending')

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Please sign in again.')
    const [requests, families] = await Promise.all([
      supabase.from('puppy_owner_updates').select('*, puppies(name, status)').order('created_at', { ascending: false }),
      (admin
        ? supabase.from('waitlist').select('name, selected_puppy_id, pending_approval, puppies(id, name, status)')
        : supabase.from('waitlist').select('name, selected_puppy_id, pending_approval, puppies(id, name, status)').ilike('email', session.user.email))
        .not('selected_puppy_id', 'is', null)
    ])
    if (requests.error || families.error) throw requests.error || families.error
    setUpdates(requests.data || [])
    const unique = new Map()
    for (const family of families.data || []) {
      if (family.puppies && !family.pending_approval) unique.set(String(family.puppies.id), { ...family.puppies, family: family.name })
    }
    setPuppies([...unique.values()])
    const photos = (requests.data || []).filter(row => row.kind === 'photo')
    if (photos.length) {
      const urls = {}
      for (let offset = 0; offset < photos.length; offset += 100) {
        const batch = photos.slice(offset, offset + 100)
        const { data, error } = await storage.from('owner-puppy-photos').createSignedUrls(batch.map(row => row.storage_path), 3600)
        if (error) throw error
        for (const row of data || []) urls[row.path] = row.signedUrl
      }
      setPreviews(urls)
    } else setPreviews({})
  }, [admin])

  useEffect(() => {
    Promise.resolve().then(load).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [load])

  async function run(work) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); await load() } catch (err) { setError(err.message || 'Could not save. Please try again.') }
    finally { setBusy(false) }
  }

  async function requestName(puppy) {
    await run(async () => {
      const name = (names[puppy.id] || '').trim()
      if (!name || name.length > 80) throw new Error('Enter a name between 1 and 80 characters.')
      if (name === puppy.name) throw new Error('Enter a different name to request a change.')
      const { data: { session } } = await supabase.auth.getSession()
      const { error } = await supabase.from('puppy_owner_updates').insert({ puppy_id: puppy.id, submitted_by: session.user.id, kind: 'name', requested_name: name })
      if (error) throw error
      setNames(current => ({ ...current, [puppy.id]: '' }))
      setNotice('Name submitted for approval. The current name stays live until approved.')
    })
  }

  async function upload(puppy, files) {
    await run(async () => {
      if (files.length > 10) throw new Error('Choose up to 10 photos at a time.')
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose JPG, PNG or WebP photos up to 10 MB each.')
      }
      const { data: { session } } = await supabase.auth.getSession()
      let count = 0
      try {
        for (const file of files) {
          const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
          const path = `${session.user.id}/${puppy.id}/${crypto.randomUUID()}.${extension}`
          await uploadStorageFile('owner-puppy-photos', path, file)
          const { error } = await supabase.from('puppy_owner_updates').insert({ puppy_id: puppy.id, submitted_by: session.user.id, kind: 'photo', storage_path: path })
          if (error) throw error
          count++
        }
      } catch (err) {
        await load()
        throw new Error(`${count ? `${count} photo(s) submitted. ` : ''}${err.message}`, { cause: err })
      }
      setNotice(`${count} photo(s) submitted for review. They will appear publicly only if approved.`)
    })
  }

  async function review(row, status) {
    await run(async () => {
      let publishedUrl = row.published_url
      let newPath = null
      if (row.kind === 'photo' && status === 'approved' && !publishedUrl) {
        const { data: file, error } = await storage.from('owner-puppy-photos').download(row.storage_path)
        if (error) throw error
        newPath = `owner-approved/${row.id}-${crypto.randomUUID()}.${row.storage_path.split('.').pop()}`
        await uploadStorageFile('puppy-photos', newPath, file)
        publishedUrl = storage.from('puppy-photos').getPublicUrl(newPath).data.publicUrl
      }
      const { data, error } = await supabase.from('puppy_owner_updates')
        .update({ status, ...(row.kind === 'photo' ? { published_url: publishedUrl } : {}) })
        .eq('id', row.id).eq('status', row.status).select('id')
      if (error || !data?.length) {
        if (newPath) await storage.from('puppy-photos').remove([newPath])
        throw error || new Error('This submission changed during review. Refresh and try again.')
      }
      setNotice(status === 'approved' ? 'Approved and published.' : status === 'hidden' ? 'Photo hidden from the public gallery.' : 'Submission declined.')
    })
  }

  const visible = updates.filter(row => !admin || filter === 'all' || row.status === filter)
  return <div>
    <h2 style={{ marginBottom: 8 }}>{admin ? 'Owner updates' : 'My Puppy'}</h2>
    <p style={{ color: '#666', marginBottom: 20 }}>{admin ? 'Review family submissions. Approve names and choose which photos appear in the public gallery.' : 'Once your puppy is sold, you can send photos and request a new name. Every update needs approval before it goes live.'}</p>
    {loading && <p>Loading…</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {notice && <p role="status" style={{ color: '#2d7a3a', marginBottom: 16 }}>{notice}</p>}
    <button style={{ ...button, marginBottom: 16 }} disabled={busy || loading} onClick={() => run(load)}>Refresh</button>
    {!admin && puppies.map(puppy => {
      const pendingName = updates.some(row => String(row.puppy_id) === String(puppy.id) && row.kind === 'name' && row.status === 'pending')
      return <section key={puppy.id} style={card}>
        <h3>{puppy.name} · <span style={{ textTransform: 'capitalize' }}>{puppy.status}</span></h3>
        {puppy.status === 'sold' ? <>
          <form onSubmit={event => { event.preventDefault(); requestName(puppy) }} style={{ marginTop: 16 }}>
            <label htmlFor={`name-${puppy.id}`}>Request a new name</label>
            <input id={`name-${puppy.id}`} style={{ ...field, margin: '8px 0' }} maxLength={80} required value={names[puppy.id] || ''} disabled={busy || pendingName} onChange={event => setNames(current => ({ ...current, [puppy.id]: event.target.value }))} />
            <button style={button} disabled={busy || pendingName}>{pendingName ? 'Name awaiting approval' : 'Submit name for approval'}</button>
          </form>
          <label style={{ display: 'block', marginTop: 20 }}>Upload photos for review (JPG, PNG or WebP, up to 10 MB each)
            <input style={{ display: 'block', marginTop: 8 }} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) upload(puppy, files) }} />
          </label>
        </> : <p style={{ marginTop: 12 }}>Photo uploads and name requests unlock when your puppy is marked Sold.</p>}
      </section>
    })}
    {!loading && !admin && !puppies.length && <p>Your approved puppy selection will appear here.</p>}
    {admin && <label style={{ display: 'block', marginBottom: 16 }}>Show submissions <select value={filter} onChange={event => setFilter(event.target.value)} style={{ ...field, width: 'auto', marginLeft: 8 }}>
      <option value="pending">Awaiting review</option><option value="approved">Live</option><option value="hidden">Hidden</option><option value="rejected">Declined</option><option value="all">All</option>
    </select></label>}
    {visible.length > 0 && <h3 style={{ marginBottom: 12 }}>{admin ? 'Submissions' : 'Your submissions'}</h3>}
    {visible.map(row => <article style={card} key={row.id}>
      <strong>{row.puppies?.name || 'Puppy'}{admin && puppies.find(p => String(p.id) === String(row.puppy_id))?.family ? ` · ${puppies.find(p => String(p.id) === String(row.puppy_id)).family}` : ''}</strong>
      <p style={{ margin: '8px 0', color: '#666' }}>{row.status === 'pending' ? 'Awaiting approval' : row.status === 'approved' ? row.kind === 'photo' ? 'Approved / live' : 'Approved' : row.status === 'rejected' ? 'Declined' : 'Hidden'} · {new Date(row.created_at).toLocaleDateString()}</p>
      {row.kind === 'name' ? <p>Requested name: <strong>{row.requested_name}</strong></p> : <img src={previews[row.storage_path]} alt={`Submitted photo of ${row.puppies?.name || 'puppy'}`} style={{ width: 240, maxWidth: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 8 }} />}
      {admin && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {(row.status === 'pending' || (row.kind === 'photo' && row.status !== 'approved')) && <button style={button} disabled={busy} onClick={() => review(row, 'approved')}>{row.kind === 'name' ? 'Approve name' : 'Publish photo'}</button>}
        {row.status === 'pending' && <button style={button} disabled={busy} onClick={() => review(row, 'rejected')}>Decline</button>}
        {row.kind === 'photo' && row.status === 'approved' && <button style={button} disabled={busy} onClick={() => review(row, 'hidden')}>Hide photo</button>}
      </div>}
    </article>)}
    {!loading && admin && !visible.length && <p>No submissions in this view.</p>}
    {busy && <p role="status">Saving…</p>}
  </div>
}
