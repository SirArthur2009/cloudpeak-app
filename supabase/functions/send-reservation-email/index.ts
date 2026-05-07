import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const { clientName, puppyName } = await req.json()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Get all admin emails
  const { data: admins } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('role', 'admin')

  const adminIds = (admins || []).map(a => a.id)
  const { data: users } = await supabase.auth.admin.listUsers()
  const adminEmails = (users?.users || [])
    .filter(u => adminIds.includes(u.id))
    .map(u => u.email)

  // Send to all admins
  await Promise.all(adminEmails.map(email =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
        to: email,
        subject: `Reservation Request: ${clientName} wants ${puppyName}`,
        html: `
          <h2>New Reservation Request</h2>
          <p><strong>${clientName}</strong> has reserved <strong>${puppyName}</strong>.</p>
          <p>Log in to your admin dashboard to approve and move to the next person on the waitlist.</p>
        `
      })
    })
  ))

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})