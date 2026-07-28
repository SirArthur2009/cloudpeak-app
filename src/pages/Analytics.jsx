import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const cardStyle = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: '10px',
  padding: '1rem'
}

export default function Analytics() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [puppies, setPuppies] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [dogs, setDogs] = useState([])
  const [websiteAnalyticsCount, setWebsiteAnalyticsCount] = useState(0)
  const [websiteAnalyticsRows, setWebsiteAnalyticsRows] = useState([])
  const [analyticsTableUsed, setAnalyticsTableUsed] = useState('')

  useEffect(() => {
    async function fetchAnalytics() {
      setLoading(true)
      setError('')

      const [puppiesRes, waitlistRes, dogsRes] = await Promise.all([
        supabase.from('puppies').select('id, status'),
        supabase.from('waitlist').select('id, position, is_active, pending_approval, selected_puppy_id'),
        supabase.from('dogs').select('id')
      ])

      if (puppiesRes.error || waitlistRes.error || dogsRes.error) {
        setError('Unable to load analytics right now. Please try again.')
        setLoading(false)
        return
      }

      setPuppies(puppiesRes.data || [])
      setWaitlist(waitlistRes.data || [])
      setDogs(dogsRes.data || [])

      // Prioritize the confirmed table name and keep legacy fallbacks.
      const tableCandidates = ['analytics_events', 'analytcis', 'analytics']
      let tableFound = false

      for (const tableName of tableCandidates) {
        const countRes = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true })

        if (countRes.error) continue

        const rowsRes = await supabase
          .from(tableName)
          .select('id, created_at, event_name, page_path, page_title, session_id, properties, referrer')
          .order('created_at', { ascending: false })
          .limit(100)

        setWebsiteAnalyticsCount(countRes.count || 0)
        setWebsiteAnalyticsRows(rowsRes.data || [])
        setAnalyticsTableUsed(tableName)
        tableFound = true
        break
      }

      if (!tableFound) {
        setError('Unable to read website analytics table. Other metrics are still shown.')
      }

      setLoading(false)
    }

    fetchAnalytics()
  }, [])

  const puppyMetrics = useMemo(() => {
    const counts = { total: puppies.length, available: 0, reserved: 0, sold: 0 }
    for (const puppy of puppies) {
      const status = (puppy.status || '').toLowerCase()
      if (status === 'available') counts.available += 1
      if (status === 'reserved') counts.reserved += 1
      if (status === 'sold') counts.sold += 1
    }
    return counts
  }, [puppies])

  const waitlistMetrics = useMemo(() => {
    const activeNow = waitlist.filter(person => person.is_active).length
    const pendingApproval = waitlist.filter(person => person.pending_approval).length
    const reserved = waitlist.filter(person => person.selected_puppy_id && !person.pending_approval).length
    return {
      total: waitlist.length,
      activeNow,
      pendingApproval,
      reserved
    }
  }, [waitlist])

  const websiteMetrics = useMemo(() => {
    const sessions = new Set()
    const eventsByName = {}
    const pageViewsByPath = {}

    for (const row of websiteAnalyticsRows) {
      if (row.session_id) sessions.add(row.session_id)

      const eventName = row.event_name || 'unknown'
      eventsByName[eventName] = (eventsByName[eventName] || 0) + 1

      const pagePath = row.page_path || 'unknown'
      pageViewsByPath[pagePath] = (pageViewsByPath[pagePath] || 0) + 1
    }

    const topEvents = Object.entries(eventsByName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const topPages = Object.entries(pageViewsByPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    return {
      totalEvents: websiteAnalyticsCount,
      uniqueSessions: sessions.size,
      topEvents,
      topPages
    }
  }, [websiteAnalyticsRows, websiteAnalyticsCount])

  function formatDateTime(value) {
    if (!value) return 'Unknown'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString()
  }

  if (loading) return <p style={{ color: '#888' }}>Loading analytics...</p>

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Analytics</h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Snapshot of puppies, waitlist activity, and pedigree records.
      </p>

      {error && (
        <p style={{ color: '#b00020', marginBottom: '1rem' }}>{error}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Puppies Total</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{puppyMetrics.total}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Available</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2d7a3a' }}>{puppyMetrics.available}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Reserved</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b36200' }}>{puppyMetrics.reserved}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Sold</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#666' }}>{puppyMetrics.sold}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Waitlist Total</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{waitlistMetrics.total}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Choosing Now</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#5555cc' }}>{waitlistMetrics.activeNow}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Pending Approval</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b36200' }}>{waitlistMetrics.pendingApproval}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Reserved from Waitlist</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2d7a3a' }}>{waitlistMetrics.reserved}</p>
        </div>
      </div>

      <div style={cardStyle}>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Pedigree Dogs</p>
        <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{dogs.length}</p>
      </div>

      <div style={{ ...cardStyle, marginTop: '1.5rem' }}>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.3rem' }}>Website Events Logged</p>
        <p style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.35rem' }}>{websiteMetrics.totalEvents}</p>
        <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Source table: {analyticsTableUsed || 'not found'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ background: '#f8f8f8', border: '1px solid #ececec', borderRadius: '8px', padding: '0.75rem' }}>
            <p style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.2rem' }}>Unique Sessions</p>
            <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>{websiteMetrics.uniqueSessions}</p>
          </div>
          <div style={{ background: '#f8f8f8', border: '1px solid #ececec', borderRadius: '8px', padding: '0.75rem' }}>
            <p style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.2rem' }}>Recent Events Loaded</p>
            <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>{websiteAnalyticsRows.length}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ border: '1px solid #ececec', borderRadius: '8px', padding: '0.75rem' }}>
            <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.5rem' }}>Top Events</p>
            {websiteMetrics.topEvents.length === 0 && <p style={{ color: '#888', fontSize: '0.85rem' }}>No event data.</p>}
            {websiteMetrics.topEvents.map(([name, count]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.25rem 0' }}>
                <span style={{ color: '#333' }}>{name}</span>
                <span style={{ color: '#666', fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid #ececec', borderRadius: '8px', padding: '0.75rem' }}>
            <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.5rem' }}>Top Pages</p>
            {websiteMetrics.topPages.length === 0 && <p style={{ color: '#888', fontSize: '0.85rem' }}>No page data.</p>}
            {websiteMetrics.topPages.map(([path, count]) => (
              <div key={path} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.25rem 0', gap: '0.5rem' }}>
                <span style={{ color: '#333', wordBreak: 'break-word' }}>{path}</span>
                <span style={{ color: '#666', fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        {websiteAnalyticsRows.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>No website analytics rows yet.</p>
        ) : (
          <div>
            <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.5rem' }}>Recent Activity</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '740px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #ececec', padding: '0.45rem' }}>Time</th>
                    <th style={{ textAlign: 'left', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #ececec', padding: '0.45rem' }}>Event</th>
                    <th style={{ textAlign: 'left', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #ececec', padding: '0.45rem' }}>Page</th>
                    <th style={{ textAlign: 'left', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #ececec', padding: '0.45rem' }}>Title</th>
                    <th style={{ textAlign: 'left', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #ececec', padding: '0.45rem' }}>Session</th>
                    <th style={{ textAlign: 'left', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #ececec', padding: '0.45rem' }}>Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {websiteAnalyticsRows.map((row, index) => (
                    <tr key={row.id || index}>
                      <td style={{ fontSize: '0.8rem', borderBottom: '1px solid #f1f1f1', padding: '0.45rem', whiteSpace: 'nowrap' }}>{formatDateTime(row.created_at)}</td>
                      <td style={{ fontSize: '0.8rem', borderBottom: '1px solid #f1f1f1', padding: '0.45rem' }}>{row.event_name || 'Unknown'}</td>
                      <td style={{ fontSize: '0.8rem', borderBottom: '1px solid #f1f1f1', padding: '0.45rem', wordBreak: 'break-word' }}>{row.page_path || '/'}</td>
                      <td style={{ fontSize: '0.8rem', borderBottom: '1px solid #f1f1f1', padding: '0.45rem', wordBreak: 'break-word' }}>{row.page_title || 'Untitled'}</td>
                      <td style={{ fontSize: '0.8rem', borderBottom: '1px solid #f1f1f1', padding: '0.45rem', wordBreak: 'break-all' }}>{row.session_id || 'Unknown'}</td>
                      <td style={{ fontSize: '0.8rem', borderBottom: '1px solid #f1f1f1', padding: '0.45rem', wordBreak: 'break-word' }}>{row.referrer || 'Direct / none'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: '#555' }}>Show raw properties</summary>
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem' }}>
                {websiteAnalyticsRows.map((row, index) => (
                  <pre
                    key={`${row.id || index}-props`}
                    style={{
                      margin: 0,
                      background: '#f7f7f7',
                      border: '1px solid #ececec',
                      borderRadius: '8px',
                      padding: '0.65rem',
                      fontSize: '0.76rem',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {JSON.stringify({
                      id: row.id,
                      event_name: row.event_name,
                      properties: row.properties
                    }, null, 2)}
                  </pre>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}