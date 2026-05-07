import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Pedigrees() {
  const [dogs, setDogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchDogs() {
      const { data, error } = await supabase
        .from('dogs')
        .select('*')
        .order('name')
      if (error) console.error(error)
      else setDogs(data)
      setLoading(false)
    }
    fetchDogs()
  }, [])

  const filtered = dogs.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Pedigrees</h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Browse our dogs and view their pedigree records.
      </p>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          padding: '0.6rem 1rem', border: '1px solid #ddd',
          borderRadius: '6px', fontSize: '0.95rem',
          width: '100%', maxWidth: '360px', marginBottom: '1.5rem'
        }}
      />

      {loading && <p style={{ color: '#888' }}>Loading...</p>}
      {!loading && filtered.length === 0 && <p style={{ color: '#888' }}>No dogs found.</p>}

      {/* Dog cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '1.25rem'
      }}>
        {filtered.map(dog => (
          <div
            key={dog.id}
            onClick={() => setSelected(dog)}
            style={{
              background: '#fff', border: '1px solid #e0e0e0',
              borderRadius: '10px', overflow: 'hidden',
              cursor: 'pointer', transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
          >
            {dog.photo_url
              ? <img src={dog.photo_url} alt={dog.name} style={{ width: '100%', height: '180px', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '180px', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>No photo</div>
            }
            <div style={{ padding: '1rem' }}>
              <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>{dog.name}</p>
              {dog.registration_number && (
                <p style={{ color: '#888', fontSize: '0.8rem' }}>Reg: {dog.registration_number}</p>
              )}
              {dog.pedigree_url && (
                <p style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.4rem' }}>📄 Pedigree available</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1rem'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px',
              maxWidth: '520px', width: '100%',
              overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.18)'
            }}
          >
            {selected.photo_url && (
              <img src={selected.photo_url} alt={selected.name} style={{ width: '100%', height: '240px', objectFit: 'cover' }} />
            )}
            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <h3 style={{ fontWeight: 600, fontSize: '1.2rem' }}>{selected.name}</h3>
                <button
                  onClick={() => setSelected(null)}
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#888', lineHeight: 1 }}
                >✕</button>
              </div>

              {selected.registration_number && (
                <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  <strong>Registration:</strong> {selected.registration_number}
                </p>
              )}

              {selected.notes && (
                <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>{selected.notes}</p>
              )}

              {selected.pedigree_url ? (
                <a
                  href={selected.pedigree_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '0.6rem 1.2rem',
                    background: '#1a1a1a', color: '#fff',
                    borderRadius: '6px', fontSize: '0.9rem',
                    textDecoration: 'none'
                  }}
                >
                  View Pedigree
                </a>
              ) : (
                <p style={{ color: '#aaa', fontSize: '0.85rem' }}>No pedigree on file.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}