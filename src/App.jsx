import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/useAuth'
import Puppies from './pages/Puppies'
import Waitlist from './pages/Waitlist'
import Pedigrees from './pages/Pedigrees'
import Admin from './pages/Admin'
import Login from './pages/Login'
import './index.css'

function App() {
  const { session, role, loading } = useAuth()

  if (loading) return <p style={{ padding: '2rem', color: '#888' }}>Loading...</p>
  console.log('role:', role)
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <nav style={{
        display: 'flex', gap: '2rem', padding: '1rem 2rem',
        borderBottom: '1px solid #e0e0e0', background: '#fff',
        alignItems: 'center'
      }}>
        <span style={{ fontWeight: 600, fontSize: '1.1rem', marginRight: 'auto' }}>
          Cloud Peak Silver Labradors
        </span>
        <NavLink to="/" style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400 })}>Available Puppies</NavLink>
        <NavLink to="/pedigrees" style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400 })}>Pedigrees</NavLink>
        <NavLink to="/waitlist" style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400 })}>Waitlist</NavLink>
        {role === 'admin' && (
          <NavLink to="/admin" style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400, color: '#888' })}>Admin</NavLink>
        )}
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ padding: '0.35rem 0.85rem', border: '1px solid #ddd', borderRadius: '6px', background: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
        >
          Sign out
        </button>
      </nav>

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem' }}>
        <Routes>
          <Route path="/" element={<Puppies />} />
          <Route path="/pedigrees" element={<Pedigrees />} />
          <Route path="/waitlist" element={<Waitlist />} />
          <Route path="/admin" element={role === 'admin' ? <Admin /> : <Navigate to="/" />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App