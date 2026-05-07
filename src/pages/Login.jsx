import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f9f7' }}>
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '380px' }}>
        <h2 style={{ fontWeight: 600, fontSize: '1.3rem', marginBottom: '0.25rem' }}>Client Portal</h2>
        <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Cloud Peak Silver Labradors</p>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ padding: '0.6rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem' }}
          />
          <input
            type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ padding: '0.6rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem' }}
          />
          {error && <p style={{ color: 'red', fontSize: '0.85rem' }}>{error}</p>}
          <button type="submit" disabled={loading} style={{
            padding: '0.65rem', background: '#1a1a1a', color: '#fff',
            border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer'
          }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p style={{ color: '#aaa', fontSize: '0.8rem', marginTop: '1.5rem', textAlign: 'center' }}>
          Access is by invitation only. Contact us to get set up.
        </p>
      </div>
    </div>
  )
}