import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
  const [reservingId, setReservingId] = useState(null)
  const [reserveMessage, setReserveMessage] = useState('')

  useEffect(() => {
    async function fetchPuppies() {
      const [puppiesRes, activeRes] = await Promise.all([
        supabase.from('puppies').select('*, litters(name)').order('id'),
        supabase.from('waitlist').select('*').eq('is_active', true).limit(1)
      ])

      if (puppiesRes.error) console.error('Supabase error:', puppiesRes.error)
      else {
        console.log('Puppies data:', puppiesRes.data)
        setPuppies(puppiesRes.data || [])
      }

      if (activeRes.error) console.error('Waitlist error:', activeRes.error)
      const active = activeRes.data?.[0] || null
      setActivePerson(active)

      if (active) {
        const { data: { session } } = await supabase.auth.getSession()
        const userEmail = session?.user?.email?.toLowerCase()
        setIsMyTurn(Boolean(userEmail && active.email?.toLowerCase() === userEmail))
      }

      setLoading(false)
    }
    fetchPuppies()
  }, [])

  async function handleReserve(puppy) {
    if (!activePerson) return
    if (!window.confirm(`Reserve ${puppy.name}?`)) return

    setReservingId(puppy.id)
    setReserveMessage('')

    const [{ error: waitlistError }, { error: puppyError }] = await Promise.all([
      supabase.from('waitlist').update({ selected_puppy_id: puppy.id, is_active: false }).eq('id', activePerson.id),
      supabase.from('puppies').update({ status: 'reserved' }).eq('id', puppy.id)
    ])

    setReservingId(null)

    if (waitlistError || puppyError) {
      console.error(waitlistError || puppyError)
      setReserveMessage('Unable to reserve this puppy. Please try again.')
      return
    }

    setReserveMessage(`${puppy.name} is reserved for you!`)
    setIsMyTurn(false)
    setActivePerson(null)
    setPuppies(prev => prev.map(p => p.id === puppy.id ? { ...p, status: 'reserved' } : p))
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
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
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

      {isMyTurn && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f0faf2', border: '1px solid #cde4d5', borderRadius: '10px' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>It's your turn on the waitlist.</p>
          <p style={{ margin: '0.4rem 0 0', color: '#555' }}>Reserve any available puppy below to lock it in.</p>
        </div>
      )}

      {reserveMessage && (
        <p style={{ color: '#2d7a3a', marginBottom: '1.5rem' }}>{reserveMessage}</p>
      )}

      {loading && <p style={{ color: '#888' }}>Loading puppies...</p>}

      {!loading && filtered.length === 0 && (
        <p style={{ color: '#888' }}>No puppies found.</p>
      )}

      {/* Puppy cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '1.25rem'
      }}>
        {filtered.map(puppy => {
          const s = statusColors[puppy.status] || statusColors.sold
          return (
            <div key={puppy.id} style={{
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: '10px',
              overflow: 'hidden'
            }}>
              {/* Photo */}
              {puppy.photo_url
                ? <img src={puppy.photo_url} alt={puppy.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                : <div style={{ width: '100%', aspectRatio: '1', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>No photo</div>
              }

              {/* Info */}
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

                {puppy.status === 'available' && isMyTurn && (
                  <button
                    onClick={() => handleReserve(puppy)}
                    disabled={reservingId === puppy.id}
                    style={{
                      marginTop: '1rem',
                      width: '100%',
                      padding: '0.65rem 0.8rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#1a1a1a',
                      color: '#fff',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    {reservingId === puppy.id ? 'Reserving...' : 'Reserve'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}