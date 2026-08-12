export default function PortalGuide() {
  const sectionStyle = {
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: '12px',
    padding: '1.25rem',
    marginBottom: '1.25rem'
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>How to use the client portal</h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        This portal is where you can view available puppies, check pedigrees, and track your place on the waitlist.
      </p>

      <div style={sectionStyle}>
        <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>1. Sign in</h3>
        <p style={{ color: '#555', lineHeight: 1.6, margin: 0 }}>
          Use the email and password you were sent for your account. If you are signing in for the first time, you may be
          asked to create a new password before continuing. After that, you’ll land on the portal dashboard.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>2. Browse available puppies</h3>
        <p style={{ color: '#555', lineHeight: 1.6, marginBottom: '0.75rem' }}>
          Select the “Available Puppies” tab from the top navigation. You can:
        </p>
        <ul style={{ color: '#555', lineHeight: 1.8, paddingLeft: '1.2rem', margin: 0 }}>
          <li>Choose a litter from the drop-down menu</li>
          <li>Filter by status: all, available, reserved, or sold</li>
          <li>Click a puppy card to review the details</li>
        </ul>
        <p style={{ color: '#555', lineHeight: 1.6, marginTop: '0.75rem', marginBottom: 0 }}>
          If it is your turn on the waitlist, you’ll see a message saying it is time to choose, and you can select a puppy
          and submit your request.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>3. Track your waitlist position</h3>
        <p style={{ color: '#555', lineHeight: 1.6, marginBottom: '0.75rem' }}>
          Open the “Waitlist” tab to view your litter and your place in line. Here you can:
        </p>
        <ul style={{ color: '#555', lineHeight: 1.8, paddingLeft: '1.2rem', margin: 0 }}>
          <li>Pick the litter you want to watch</li>
          <li>See who is currently choosing</li>
          <li>Check whether your family is next in line</li>
          <li>See whether a puppy is pending approval or already reserved</li>
        </ul>
        <p style={{ color: '#555', lineHeight: 1.6, marginTop: '0.75rem', marginBottom: 0 }}>
          If another family is choosing, you’ll see a note telling you to check back later. When it is your turn, a “Choose a Puppy” button appears.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>4. Review pedigrees</h3>
        <p style={{ color: '#555', lineHeight: 1.6, marginBottom: '0.75rem' }}>
          Select “Pedigrees” to search for dogs by name and open their profile card. From there you can:
        </p>
        <ul style={{ color: '#555', lineHeight: 1.8, paddingLeft: '1.2rem', margin: 0 }}>
          <li>Search for a dog by name</li>
          <li>View registration and pedigree details</li>
          <li>Open links for pedigree, Embark, or OFA records when available</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>5. Sign out</h3>
        <p style={{ color: '#555', lineHeight: 1.6, margin: 0 }}>
          Use the “Sign out” button in the top-right corner when you’re finished. You can sign back in anytime with your account information.
        </p>
      </div>

      <div style={{ background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1rem 1.25rem' }}>
        <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Need help?</p>
        <p style={{ color: '#555', margin: 0 }}>
          If something looks different than expected or you need a password reset, contact the Cloud Peak team and we’ll help you get back in.
        </p>
      </div>
    </div>
  )
}
