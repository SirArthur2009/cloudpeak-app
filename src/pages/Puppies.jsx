import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
const SERVICE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_KEY

async function callFunction(name, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify(body)
  })
  return res.json()
}

function isMissingLitterIdColumnError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes("could not find the 'litter_id' column") || msg.includes('column "litter_id" does not exist')
}

const statusColors = {
  available: { bg: '#e6f4ea', color: '#2d7a3a' },
  reserved: { bg: '#fff4e5', color: '#b36200' },
  sold: { bg: '#f0f0f0', color: '#888' }
}

async function archiveLatestApplicationForEmail(email) {
  if (!email) return

  const normalized = email.trim().toLowerCase()
  const { data: latestApplication, error: fetchError } = await supabase
    .from('applications')
    .select('id')
    .ilike('email', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fetchError || !latestApplication?.id) {
    if (fetchError) console.warn('Could not fetch latest application to archive:', fetchError.message)
    return
  }

  const { error: archiveError } = await supabase
    .from('applications')
    .update({ status: 'archived' })
    .eq('id', latestApplication.id)

  if (archiveError) console.warn('Could not archive application:', archiveError.message)
}

export default function Puppies() {
  const [puppies, setPuppies] = useState([])
  const [photosByPuppy, setPhotosByPuppy] = useState({})
  const [litters, setLitters] = useState([])
  const [selectedLitterId, setSelectedLitterId] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [clientView, setClientView] = useState('assigned')
  const [activePerson, setActivePerson] = useState(null)
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [selectedPuppy, setSelectedPuppy] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [assignedLitterId, setAssignedLitterId] = useState('')
  const [gallery, setGallery] = useState(null)

  useEffect(() => {
    async function fetchAll() {
      const { data: { session } } = await supabase.auth.getSession()
      const currentUserEmail = session?.user?.email?.toLowerCase() || ''
      setUserEmail(currentUserEmail)

      const [{ data: profile }, { data: myWaitlistEntries }] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', session?.user?.id).single(),
        supabase
          .from('waitlist')
          .select('litter_id')
          .ilike('email', currentUserEmail)
          .order('position')
          .limit(1)
      ])
      const userIsAdmin = profile?.role === 'admin'
      setIsAdmin(userIsAdmin)

      const assignedLitterId = myWaitlistEntries?.[0]?.litter_id || ''
      setAssignedLitterId(String(assignedLitterId))
      const [puppiesRes, activeRes, littersRes, photosRes] = await Promise.all([
        supabase.from('puppies').select('*, litters(name)').order('id'),
        userIsAdmin
          ? supabase.from('waitlist').select('*').eq('is_active', true)
          : assignedLitterId
          ? supabase.from('waitlist').select('*').eq('is_active', true).eq('litter_id', assignedLitterId)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('litters').select('id, name').order('created_at', { ascending: false }),
        supabase.from('puppy_photos').select('puppy_id, photo_url, caption, sort_order, created_at').order('sort_order').order('created_at')
      ])

      if (puppiesRes.error) console.error('Supabase error:', puppiesRes.error)
      else setPuppies(puppiesRes.data || [])

      if (photosRes.error) console.error('Puppy photos error:', photosRes.error)
      else {
        const groupedPhotos = (photosRes.data || []).reduce((groups, photo) => {
          const puppyId = String(photo.puppy_id)
          groups[puppyId] = [...(groups[puppyId] || []), photo]
          return groups
        }, {})
        setPhotosByPuppy(groupedPhotos)
      }

      const activeRows = activeRes.data || []
      const litterList = littersRes.data || []
      setLitters(litterList)

      const myActiveEntry = activeRows.find(row => row.email?.toLowerCase() === currentUserEmail)
      const defaultLitterId = myActiveEntry?.litter_id || assignedLitterId || (userIsAdmin ? litterList[0]?.id : '')
      const selectedId = String(defaultLitterId || '')
      setSelectedLitterId(selectedId)

      const activeForLitter = activeRows.find(row => String(row.litter_id || '') === selectedId) || null
      setActivePerson(activeForLitter)

      setIsMyTurn(Boolean(currentUserEmail && activeForLitter?.email?.toLowerCase() === currentUserEmail))

      setLoading(false)
    }
    fetchAll()
  }, [])

  useEffect(() => {
    if (!selectedLitterId) {
      setActivePerson(null)
      setIsMyTurn(false)
      return
    }

    async function refreshActiveForLitter() {
      const result = await supabase
        .from('waitlist')
        .select('*')
        .eq('is_active', true)
        .eq('litter_id', selectedLitterId)
        .limit(1)

      let active = result.data?.[0] || null
      if (result.error && isMissingLitterIdColumnError(result.error)) {
        const fallback = await supabase
          .from('waitlist')
          .select('*')
          .eq('is_active', true)
          .limit(1)
        active = fallback.data?.[0] || null
      }

      setActivePerson(active)
      setIsMyTurn(Boolean(userEmail && active?.email?.toLowerCase() === userEmail))
    }

    refreshActiveForLitter()
  }, [selectedLitterId, userEmail])

  useEffect(() => {
    if (!gallery) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') setGallery(null)
      if (event.key === 'ArrowLeft') setGallery(current => current && { ...current, photoIndex: Math.max(0, current.photoIndex - 1) })
      if (event.key === 'ArrowRight') setGallery(current => current && { ...current, photoIndex: Math.min(current.photos.length - 1, current.photoIndex + 1) })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [gallery])

  async function handleConfirmSelection() {
    if (!selectedPuppy || !activePerson) return
    if (!isAdmin && String(selectedPuppy.litter_id || '') !== assignedLitterId) {
      setError('You can only select a puppy from your assigned litter.')
      return
    }
    setSaving(true)
    setError('')

    // Set pending approval — don't reserve yet
    const { error } = await supabase
      .from('waitlist')
      .update({
        selected_puppy_id: selectedPuppy.id,
        is_active: false,
        pending_approval: true
      })
      .eq('id', activePerson.id)

    if (error) {
      setError('Something went wrong. Please try again.')
      console.error(error)
      setSaving(false)
      return
    }

    await archiveLatestApplicationForEmail(activePerson.email)

    // Email admins
    try {
      await callFunction('send-reservation-email', {
        clientName: activePerson.name,
        puppyName: selectedPuppy.name
      })
    } catch (err) {
      console.error('Email failed:', err)
    }

    setConfirmed(true)
    setSaving(false)
  }

  const puppiesForLitter = isAdmin
    ? selectedLitterId
      ? puppies.filter(p => String(p.litter_id || '') === selectedLitterId)
      : puppies
    : clientView === 'assigned'
      ? puppies.filter(p => String(p.litter_id || '') === assignedLitterId)
      : puppies.filter(p => String(p.litter_id || '') !== assignedLitterId)

  const filtered = filter === 'all'
    ? puppiesForLitter
    : puppiesForLitter.filter(p => p.status === filter)

  function openGallery(puppy) {
    const extraPhotos = photosByPuppy[String(puppy.id)] || []
    const photos = [
      ...(puppy.photo_url ? [{ photo_url: puppy.photo_url, caption: null }] : []),
      ...extraPhotos.filter(photo => photo.photo_url !== puppy.photo_url)
    ]
    setGallery({ puppy, photos, photoIndex: 0 })
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
        Available Puppies
      </h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Browse our current and upcoming puppies below.
      </p>

      {isAdmin ? (
        <div style={{ marginBottom: '1rem', maxWidth: '420px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Litter</label>
          <select
            value={selectedLitterId}
            onChange={(e) => {
              setSelectedLitterId(e.target.value)
              setSelectedPuppy(null)
              setConfirmed(false)
              setError('')
            }}
            style={{ width: '100%', padding: '0.55rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.9rem' }}
          >
            <option value="">All litters</option>
            {litters.map(litter => <option key={litter.id} value={litter.id}>{litter.name}</option>)}
          </select>
        </div>
      ) : null}

      {!isAdmin && assignedLitterId && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => { setClientView('assigned'); setSelectedPuppy(null); setConfirmed(false); setError('') }}
            style={{
              padding: '0.4rem 1rem', borderRadius: '6px', border: '1px solid #ddd',
              background: clientView === 'assigned' ? '#1a1a1a' : '#fff',
              color: clientView === 'assigned' ? '#fff' : '#333', cursor: 'pointer', fontWeight: clientView === 'assigned' ? 600 : 400
            }}
          >
            Your Litter
          </button>
          <button
            onClick={() => { setClientView('other'); setSelectedPuppy(null); setConfirmed(false); setError('') }}
            style={{
              padding: '0.4rem 1rem', borderRadius: '6px', border: '1px solid #ddd',
              background: clientView === 'other' ? '#1a1a1a' : '#fff',
              color: clientView === 'other' ? '#fff' : '#333', cursor: 'pointer', fontWeight: clientView === 'other' ? 600 : 400
            }}
          >
            Other Litters
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {['all', 'available', 'reserved', 'sold'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '0.4rem 1rem',
            borderRadius: '6px',
            border: '1px solid #ddd',
            background: filter === f ? '#1a1a1a' : '#fff',
            color: filter === f ? '#fff' : '#333',
            cursor: 'pointer',
            fontWeight: filter === f ? 600 : 400,
            textTransform: 'capitalize'
          }}>
            {f}
          </button>
        ))}
      </div>

      {/* It's the logged-in user's turn */}
      {isMyTurn && !confirmed && (
        <div style={{ background: '#f0faf2', border: '1px solid #b2dfb8', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>🎉 It's your turn to pick!</p>
          <p style={{ color: '#555', fontSize: '0.9rem' }}>Click a puppy below to select it, then confirm your request.</p>
        </div>
      )}

      {/* Confirmation message */}
      {confirmed && (
        <div style={{ background: '#fff8e5', border: '1px solid #ffe08a', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '1rem' }}>✅ Your request for {selectedPuppy?.name} has been submitted!</p>
          <p style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.25rem' }}>We'll review your selection and confirm shortly.</p>
        </div>
      )}

      {/* Selected puppy confirm bar */}
      {isMyTurn && !confirmed && selectedPuppy && (
        <div style={{ background: '#fff', border: '2px solid #1a1a1a', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <p style={{ fontWeight: 600 }}>Selected: {selectedPuppy.name}</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleConfirmSelection}
              disabled={saving}
              style={{ padding: '0.55rem 1.2rem', background: '#2d7a3a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
            >
              {saving ? 'Submitting...' : `Request ${selectedPuppy.name}`}
            </button>
            <button
              onClick={() => setSelectedPuppy(null)}
              style={{ padding: '0.55rem 1rem', background: '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}

      {loading && <p style={{ color: '#888' }}>Loading puppies...</p>}
      {!loading && filtered.length === 0 && <p style={{ color: '#888' }}>No puppies found.</p>}

      {/* Puppy cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '1.25rem'
      }}>
        {filtered.map(puppy => {
          const s = statusColors[puppy.status] || statusColors.sold
          const isSelected = selectedPuppy?.id === puppy.id
          const canSelectPuppy = isMyTurn && !confirmed && puppy.status === 'available' && (isAdmin || String(puppy.litter_id || '') === assignedLitterId)
          return (
            <div
              key={puppy.id}
              role="button"
              tabIndex={0}
              aria-label={`View photos of ${puppy.name}`}
              onClick={() => openGallery(puppy)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openGallery(puppy)
                }
              }}
              style={{
                background: '#fff',
                border: isSelected ? '2px solid #1a1a1a' : '1px solid #e0e0e0',
                borderRadius: '10px',
                overflow: 'hidden',
                cursor: 'pointer',
                transform: isSelected ? 'scale(1.02)' : 'none',
                transition: 'all 0.15s'
              }}
            >
              {puppy.photo_url
                ? <img src={puppy.photo_url} alt={puppy.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                : <div style={{ width: '100%', aspectRatio: '1', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>No photo</div>
              }

              <div style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '1rem' }}>{puppy.name}</span>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    padding: '0.2rem 0.6rem', borderRadius: '20px',
                    background: s.bg, color: s.color,
                    textTransform: 'capitalize'
                  }}>
                    {puppy.status}
                  </span>
                </div>
                <p style={{ color: '#555', fontSize: '0.9rem' }}>{puppy.gender} · {puppy.color}</p>
                {puppy.litters?.name && (
                  <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.3rem' }}>{puppy.litters.name}</p>
                )}
                {puppy.notes && (
                  <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.5rem' }}>{puppy.notes}</p>
                )}
                {canSelectPuppy && (
                  <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    {isSelected ? 'Selected - confirm above' : 'Click to view photos and select'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {gallery && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${gallery.puppy.name} photo gallery`}
          onClick={() => setGallery(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(0, 0, 0, 0.82)' }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(900px, 100%)', maxHeight: 'calc(100vh - 2rem)', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.85rem 1rem', borderBottom: '1px solid #e0e0e0' }}>
              <div>
                <p style={{ fontWeight: 600 }}>{gallery.puppy.name}</p>
                {gallery.photos.length > 1 && <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.15rem' }}>{gallery.photoIndex + 1} of {gallery.photos.length}</p>}
              </div>
              <button onClick={() => setGallery(null)} aria-label="Close photo gallery" title="Close" style={{ width: '2.25rem', height: '2.25rem', border: 'none', background: 'transparent', color: '#333', cursor: 'pointer', fontSize: '1.7rem', lineHeight: 1 }}>&times;</button>
            </div>

            <div style={{ position: 'relative', minHeight: '240px', background: '#161616', display: 'grid', placeItems: 'center' }}>
              {gallery.photos.length > 0
                ? <img src={gallery.photos[gallery.photoIndex].photo_url} alt={gallery.photos[gallery.photoIndex].caption || `${gallery.puppy.name} photo ${gallery.photoIndex + 1}`} style={{ display: 'block', width: '100%', maxHeight: 'calc(100vh - 13rem)', objectFit: 'contain' }} />
                : <p style={{ color: '#fff' }}>No photos available for this puppy.</p>
              }
              {gallery.photos.length > 1 && <>
                <button onClick={() => setGallery(current => ({ ...current, photoIndex: Math.max(0, current.photoIndex - 1) }))} disabled={gallery.photoIndex === 0} aria-label="Previous photo" title="Previous photo" style={{ position: 'absolute', left: '0.75rem', width: '2.5rem', height: '2.5rem', border: 'none', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.9)', color: '#1a1a1a', cursor: gallery.photoIndex === 0 ? 'default' : 'pointer', fontSize: '1.5rem', opacity: gallery.photoIndex === 0 ? 0.45 : 1 }}>&lsaquo;</button>
                <button onClick={() => setGallery(current => ({ ...current, photoIndex: Math.min(current.photos.length - 1, current.photoIndex + 1) }))} disabled={gallery.photoIndex === gallery.photos.length - 1} aria-label="Next photo" title="Next photo" style={{ position: 'absolute', right: '0.75rem', width: '2.5rem', height: '2.5rem', border: 'none', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.9)', color: '#1a1a1a', cursor: gallery.photoIndex === gallery.photos.length - 1 ? 'default' : 'pointer', fontSize: '1.5rem', opacity: gallery.photoIndex === gallery.photos.length - 1 ? 0.45 : 1 }}>&rsaquo;</button>
              </>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.85rem 1rem', flexWrap: 'wrap' }}>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>{gallery.photos[gallery.photoIndex]?.caption || `${gallery.puppy.gender} - ${gallery.puppy.color}`}</p>
              {isMyTurn && !confirmed && gallery.puppy.status === 'available' && (isAdmin || String(gallery.puppy.litter_id || '') === assignedLitterId) && (
                <button
                  onClick={() => { setSelectedPuppy(gallery.puppy); setGallery(null) }}
                  style={{ padding: '0.55rem 1rem', background: '#2d7a3a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {selectedPuppy?.id === gallery.puppy.id ? `${gallery.puppy.name} selected` : `Select ${gallery.puppy.name}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}