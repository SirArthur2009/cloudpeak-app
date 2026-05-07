import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/useAuth'
import Puppies from './pages/Puppies'
import Waitlist from './pages/Waitlist'
import Pedigrees from './pages/Pedigrees'
import Admin from './pages/Admin'
import Login from './pages/Login'
import './index.css'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

function App() {
  const { session, role, loading } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const isMobile = useIsMobile()

  if (loading) return <p style={{ padding: '2rem', color: '#888' }}>Loading...</p>
  if (!session) return <Login />

  const activeLinkStyle = ({ isActive }) => ({
    fontWeight: isActive ? 600 : 400,
    color: isActive ? '#1a1a1a' : '#555',
    textDecoration: 'none',
    fontSize: '0.95rem',
  })

  const mobileLinkStyle = ({ isActive }) => ({
    fontWeight: isActive ? 600 : 400,
    color: isActive ? '#1a1a1a' : '#555',
    textDecoration: 'none',
    fontSize: '1rem',
    padding: '0.75rem 1rem',
    borderRadius: '8px',
    background: isActive ? '#f0f0f0' : 'transparent',
    display: 'block'
  })

  return (
    <BrowserRouter>
      <nav style={{
        padding: '0 2rem',
        borderBottom: '1px solid #e0e0e0',
        background: '#fff',
        position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          height: '56px'
        }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', marginRight: '2rem' }}>
            Cloud Peak Silver Labradors
          </span>

          {/* Desktop nav */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem', flex: 1 }}>
              <NavLink to="/" style={activeLinkStyle}>Available Puppies</NavLink>
              <NavLink to="/pedigrees" style={activeLinkStyle}>Pedigrees</NavLink>
              <NavLink to="/waitlist" style={activeLinkStyle}>Waitlist</NavLink>
              {role === 'admin' && (
                <NavLink to="/admin" style={({ isActive }) => ({ ...activeLinkStyle({ isActive }), color: isActive ? '#1a1a1a' : '#888' })}>Admin</NavLink>
              )}
              <button
                onClick={() => supabase.auth.signOut()}
                style={{
                  marginLeft: 'auto',
                  padding: '0.35rem 0.85rem',
                  border: '1px solid #ddd', borderRadius: '6px',
                  background: '#fff', cursor: 'pointer', fontSize: '0.9rem'
                }}
              >
                Sign out
              </button>
            </div>
          )}

          {/* Mobile hamburger */}
          {isMobile && (
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', padding: '0.25rem',
                display: 'flex', flexDirection: 'column',
                gap: '5px', justifyContent: 'center'
              }}
            >
              <span style={{ display: 'block', width: '24px', height: '2px', background: '#1a1a1a', transition: 'all 0.2s', transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none' }} />
              <span style={{ display: 'block', width: '24px', height: '2px', background: '#1a1a1a', transition: 'all 0.2s', opacity: menuOpen ? 0 : 1 }} />
              <span style={{ display: 'block', width: '24px', height: '2px', background: '#1a1a1a', transition: 'all 0.2s', transform: menuOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none' }} />
            </button>
          )}
        </div>

        {/* Mobile dropdown */}
        {isMobile && menuOpen && (
          <div style={{ paddingBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <NavLink to="/" style={mobileLinkStyle} onClick={() => setMenuOpen(false)}>Available Puppies</NavLink>
            <NavLink to="/pedigrees" style={mobileLinkStyle} onClick={() => setMenuOpen(false)}>Pedigrees</NavLink>
            <NavLink to="/waitlist" style={mobileLinkStyle} onClick={() => setMenuOpen(false)}>Waitlist</NavLink>
            {role === 'admin' && (
              <NavLink to="/admin" style={mobileLinkStyle} onClick={() => setMenuOpen(false)}>Admin</NavLink>
            )}
            <button
              onClick={() => { supabase.auth.signOut(); setMenuOpen(false) }}
              style={{
                padding: '0.75rem 1rem', background: 'none',
                border: '1px solid #e0e0e0', borderRadius: '8px',
                cursor: 'pointer', fontSize: '1rem',
                color: '#888', textAlign: 'left', marginTop: '0.25rem'
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </nav>

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.25rem' }}>
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
