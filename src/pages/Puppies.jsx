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

const statusColors = {
  available: { bg: '#e6f4ea', color: '#2d7a3a' },
  reserved: { bg: '#fff4e5', color: '#b36200' },
  sold: { bg: '#f0f0f0', color: '#888' }
}

export default function Puppies() {
  const [puppies, setPuppies] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [activePerson, setActivePerson] = useState(null)
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [selectedPuppy, setSelectedPuppy] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchAll() {
      const [puppiesRes, activeRes] = await Promise.all([
        supabase.from('puppies').select('*, litters(name)').order('id'),
        supabase.from('waitlist').select('*').eq('is_active', true).limit(1)
      ])

      if (puppiesRes.error) console.error('Supabase error:', puppiesRes.error)
      else setPuppies(puppiesRes.data || [])

      const active = activeRes.data?.[0] || null
      setActivePerson(active)

      if (active) {
        const { data: { session } } = await supabase.auth.getSession()
        const userEmail = session?.user?.email?.toLowerCase()
        setIsMyTurn(Boolean(userEmail && active.email?.toLowerCase() === userEmail))
      }

      setLoading(false)
    }
    fetchAll()
  }, [])

  async function handleConfirmSelection() {
    if (!selectedPuppy || !activePerson) return
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

  const filtered = filter === 'all'
    ? puppies
    : puppies.filter(p => p.status === filter)

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
        Available Puppies
      </h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Browse our current and upcoming puppies below.
      </p>

      {/* Filter buttons */}
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
          return (
            <div
              key={puppy.id}
              onClick={() => {
                if (isMyTurn && !confirmed && puppy.status === 'available') {
                  setSelectedPuppy(isSelected ? null : puppy)
                }
              }}
              style={{
                background: '#fff',
                border: isSelected ? '2px solid #1a1a1a' : '1px solid #e0e0e0',
                borderRadius: '10px',
                overflow: 'hidden',
                cursor: isMyTurn && !confirmed && puppy.status === 'available' ? 'pointer' : 'default',
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
                {isMyTurn && !confirmed && puppy.status === 'available' && (
                  <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    {isSelected ? '✓ Selected — confirm above' : 'Click to select'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}