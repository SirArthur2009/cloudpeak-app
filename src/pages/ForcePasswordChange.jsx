import { useState } from 'react'

export default function ForcePasswordChange({ onSubmit, loading = false, error = '', success = '' }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLocalError('')

    if (!password || !confirmPassword) {
      setLocalError('Please enter and confirm your new password.')
      return
    }

    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.')
      return
    }

    await onSubmit(password)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f9f7' }}>
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '420px' }}>
        <h2 style={{ fontWeight: 600, fontSize: '1.3rem', marginBottom: '0.25rem' }}>Set a new password</h2>
        <p style={{ color: '#888', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
          This is your first sign-in, so you need to choose a new password before continuing.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: '0.7rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem' }}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{ padding: '0.7rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem' }}
          />

          {(error || localError) && <p style={{ color: 'red', fontSize: '0.85rem', margin: 0 }}>{error || localError}</p>}
          {success && <p style={{ color: 'green', fontSize: '0.85rem', margin: 0 }}>{success}</p>}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '0.7rem',
              background: '#1a1a1a',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '1rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.8 : 1
            }}
          >
            {loading ? 'Updating password...' : 'Save new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
