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

export default function Waitlist() {
  const [waitlist, setWaitlist] = useState([])
  const [puppies, setPuppies] = useState([])
  const [loading, setLoading] = useState(true)
  const [activePerson, setActivePerson] = useState(null)
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [myEntry, setMyEntry] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedPuppy, setSelectedPuppy] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchAll() {
      const { data: { session } } = await supabase.auth.getSession()
      const userEmail = session?.user?.email?.toLowerCase()

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session?.user?.id)
        .single()
      setIsAdmin(profile?.role === 'admin')

      const [{ data: w }, { data: p }] = await Promise.all([
        supabase.from('waitlist').select('*, puppies(name, color, gender)').order('position'),
        supabase.from('puppies').select('*').eq('status', 'available').order('id')
      ])

      setWaitlist(w || [])
      setPuppies(p || [])

      const active = (w || []).find(person => person.is_active)
      setActivePerson(active || null)

      const mine = (w || []).find(person => person.email?.toLowerCase() === userEmail)
      setMyEntry(mine || null)

      if (active && userEmail && active.email?.toLowerCase() === userEmail) {
        setIsMyTurn(true)
      }

      setLoading(false)
    }
    fetchAll()
  }, [])

  async function handleConfirmSelection() {
    console.log('SERVICE_KEY exists:', !!SERVICE_KEY)
    console.log('FUNCTIONS_URL:', FUNCTIONS_URL)
    if (!selectedPuppy || !activePerson) return
    setSaving(true)
    setError('')

    const { error } = await supabase
      .from('waitlist')
      .update({ selected_puppy_id: selectedPuppy.id, is_active: false, pending_approval: true })
      .eq('id', activePerson.id)

    if (error) {
      setError('Something went wrong. Please try again.')
      console.error(error)
      setSaving(false)
      return
    }

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

  function displayName(person, index) {
    if (isAdmin) return person.name
    if (person.email?.toLowerCase() === myEntry?.email?.toLowerCase()) return `${person.name} (You)`
    return `Client #${index + 1}`
  }

  if (loading) return <p style={{ color: '#888' }}>Loading...</p>

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Waitlist</h2>
      <p style={{ color: '#666', marginBottom: '2rem' }}>Positions are assigned after your deposit is received.</p>

      {activePerson && !isMyTurn && (
        <div style={{ background: '#f5f5ff', border: '1px solid #c5c5f0', borderRadius: '10px', padding: '1.25rem', marginBottom: '2rem' }}>
          <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>🐾 Another family is currently choosing</p>
          <p style={{ color: '#555', fontSize: '0.9rem' }}>Check back soon — you'll be notified by email when it's your turn.</p>
        </div>
      )}

      {isMyTurn && !confirmed && (
        <div style={{ background: '#f0faf2', border: '1px solid #b2dfb8', borderRadius: '10px', padding: '1.25rem', marginBottom: '2rem' }}>
          <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>🎉 It's your turn to pick!</p>
          <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>
            {puppies.length > 0 ? 'Select a puppy below to submit your request.' : "No puppies are currently available. We'll reach out when they are!"}
          </p>

          {!selecting && puppies.length > 0 && (
            <button onClick={() => setSelecting(true)} style={{ padding: '0.55rem 1.2rem', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
              Choose a Puppy
            </button>
          )}

          {selecting && (
            <div>
              <p style={{ fontWeight: 500, marginBottom: '0.75rem', fontSize: '0.9rem' }}>Available puppies:</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                {puppies.map(puppy => (
                  <div key={puppy.id} onClick={() => setSelectedPuppy(puppy)} style={{ background: selectedPuppy?.id === puppy.id ? '#1a1a1a' : '#fff', color: selectedPuppy?.id === puppy.id ? '#fff' : '#1a1a1a', border: `2px solid ${selectedPuppy?.id === puppy.id ? '#1a1a1a' : '#ddd'}`, borderRadius: '8px', padding: '0.75rem', cursor: 'pointer', transition: 'all 0.15s' }}>
                    {puppy.photo_url && <img src={puppy.photo_url} alt={puppy.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '4px', marginBottom: '0.5rem' }} />}
                    <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>{puppy.name}</p>
                    <p style={{ fontSize: '0.8rem', opacity: 0.75 }}>{puppy.gender} · {puppy.color}</p>
                  </div>
                ))}
              </div>

              {error && <p style={{ color: 'red', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

              {selectedPuppy && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button onClick={handleConfirmSelection} disabled={saving} style={{ padding: '0.55rem 1.2rem', background: '#2d7a3a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                    {saving ? 'Submitting...' : `Request ${selectedPuppy.name}`}
                  </button>
                  <button onClick={() => { setSelecting(false); setSelectedPuppy(null) }} style={{ padding: '0.55rem 1rem', background: '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirmed && (
        <div style={{ background: '#fff8e5', border: '1px solid #ffe08a', borderRadius: '10px', padding: '1.25rem', marginBottom: '2rem' }}>
          <p style={{ fontWeight: 600, fontSize: '1rem' }}>✅ Your request for {selectedPuppy?.name} has been submitted!</p>
          <p style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.25rem' }}>We'll review your selection and confirm shortly.</p>
        </div>
      )}

      <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '1rem' }}>Current Waitlist</h3>
      {waitlist.length === 0 && <p style={{ color: '#888' }}>The waitlist is currently empty.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {waitlist.map((person, index) => {
          const isMe = person.email?.toLowerCase() === myEntry?.email?.toLowerCase()
          const isCurrentlyPicking = person.is_active
          const isPending = person.pending_approval
          const isReserved = person.selected_puppy_id && !person.pending_approval

          let bg = '#fff'
          let border = '#e0e0e0'
          if (isMe) { bg = '#f0faf2'; border = '#b2dfb8' }
          else if (isCurrentlyPicking) { bg = '#f5f5ff'; border = '#c5c5f0' }

          return (
            <div key={person.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', background: bg, border: `1px solid ${border}`, borderRadius: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: '#aaa', minWidth: '28px' }}>#{person.position}</span>
              <span style={{ fontWeight: isMe || isCurrentlyPicking ? 600 : 400, flex: 1 }}>{displayName(person, index)}</span>

              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {isMe && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#d4edda', color: '#2d7a3a' }}>You</span>
                )}
                {isCurrentlyPicking && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#e8e8ff', color: '#5555cc' }}>Choosing now</span>
                )}
                {isPending && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#fff4e5', color: '#b36200' }}>Pending approval</span>
                )}
                {isReserved && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#e6f4ea', color: '#2d7a3a' }}>Reserved</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}