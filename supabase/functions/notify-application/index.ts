// supabase/functions/notify-application/index.ts
// Deploy with: supabase functions deploy notify-application
//
// Required secrets (set via Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        — get a free key at resend.com
//   SUPABASE_URL          — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase (needed to query auth.users)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  try {
    const app = await req.json()
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY' }), { status: 500 })
    }

    // Use service role key to query profiles + auth.users
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all admin profile IDs
    const { data: adminProfiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin')

    if (profilesError) throw new Error('Could not fetch admin profiles: ' + profilesError.message)
    if (!adminProfiles || adminProfiles.length === 0) throw new Error('No admin profiles found')

    // Get email addresses from auth.users for each admin ID
    const adminEmails: string[] = []
    for (const profile of adminProfiles) {
      const { data: { user }, error } = await supabase.auth.admin.getUserById(profile.id)
      if (!error && user?.email) adminEmails.push(user.email)
    }

    if (adminEmails.length === 0) throw new Error('No admin emails found')

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0F6E56;padding:1.5rem;border-radius:8px 8px 0 0;">
          <h2 style="color:#fff;margin:0;">New Puppy Application</h2>
          <p style="color:#9FE1CB;margin:0.25rem 0 0;">Cloud Peak Silver Labradors</p>
        </div>
        <div style="background:#f9f9f7;padding:1.5rem;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;">

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;">Contact</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">Name</td><td style="padding:4px 8px;"><strong>${app.first_name} ${app.last_name}</strong></td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Email</td><td style="padding:4px 8px;"><a href="mailto:${app.email}">${app.email}</a></td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Phone</td><td style="padding:4px 8px;">${app.phone || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Address</td><td style="padding:4px 8px;">${[app.address_line1, app.city, app.state, app.zip, app.country].filter(Boolean).join(', ') || '—'}</td></tr>
          </table>

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;margin-top:1.5rem;">Preferences</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">Gender preference</td><td style="padding:4px 8px;">${app.gender_preference || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Color preference</td><td style="padding:4px 8px;">${app.color_preference || '—'}</td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Registration</td><td style="padding:4px 8px;">${app.registration_type || '—'}</td></tr>
          </table>

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;margin-top:1.5rem;">Home & Lifestyle</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">Fence/containment</td><td style="padding:4px 8px;">${app.has_fence || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Indoor/outdoor</td><td style="padding:4px 8px;">${app.indoor_outdoor || '—'}</td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Vet info</td><td style="padding:4px 8px;">${app.vet_info || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Home situation</td><td style="padding:4px 8px;">${app.home_situation || '—'}</td></tr>
          </table>

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;margin-top:1.5rem;">More</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">How found</td><td style="padding:4px 8px;">${app.how_found || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Training goals</td><td style="padding:4px 8px;">${app.training_goals || '—'}</td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Agreement questions</td><td style="padding:4px 8px;">${app.purchase_agreement_questions || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Other questions</td><td style="padding:4px 8px;">${app.other_questions || 'None'}</td></tr>
          </table>

          <div style="margin-top:1.5rem;padding:1rem;background:#E1F5EE;border-radius:6px;text-align:center;">
            <p style="margin:0;font-size:14px;color:#085041;">Review this application in your admin portal</p>
          </div>
        </div>
      </div>
    `

    // Send to all admins
    await Promise.all(adminEmails.map(email =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
          to: email,
          subject: `New puppy application — ${app.first_name} ${app.last_name}`,
          html
        })
      })
    ))

    return new Response(JSON.stringify({ ok: true, sent_to: adminEmails }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  try {
    const app = await req.json()

    const adminEmails = (Deno.env.get('ADMIN_EMAILS') || '').split(',').map(e => e.trim()).filter(Boolean)
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!resendKey || adminEmails.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY or ADMIN_EMAILS env vars' }), { status: 500 })
    }

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0F6E56;padding:1.5rem;border-radius:8px 8px 0 0;">
          <h2 style="color:#fff;margin:0;">New Puppy Application</h2>
          <p style="color:#9FE1CB;margin:0.25rem 0 0;">Cloud Peak Silver Labradors</p>
        </div>
        <div style="background:#f9f9f7;padding:1.5rem;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;">

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;">Contact</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">Name</td><td style="padding:4px 8px;"><strong>${app.first_name} ${app.last_name}</strong></td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Email</td><td style="padding:4px 8px;"><a href="mailto:${app.email}">${app.email}</a></td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Phone</td><td style="padding:4px 8px;">${app.phone || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Address</td><td style="padding:4px 8px;">${[app.address_line1, app.city, app.state, app.zip, app.country].filter(Boolean).join(', ') || '—'}</td></tr>
          </table>

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;margin-top:1.5rem;">Preferences</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">Gender preference</td><td style="padding:4px 8px;">${app.gender_preference || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Color preference</td><td style="padding:4px 8px;">${app.color_preference || '—'}</td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Registration</td><td style="padding:4px 8px;">${app.registration_type || '—'}</td></tr>
          </table>

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;margin-top:1.5rem;">Home & Lifestyle</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">Fence/containment</td><td style="padding:4px 8px;">${app.has_fence || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Indoor/outdoor</td><td style="padding:4px 8px;">${app.indoor_outdoor || '—'}</td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Vet info</td><td style="padding:4px 8px;">${app.vet_info || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Home situation</td><td style="padding:4px 8px;">${app.home_situation || '—'}</td></tr>
          </table>

          <h3 style="color:#333;border-bottom:2px solid #4ECBA0;padding-bottom:0.5rem;margin-top:1.5rem;">More</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:#666;width:40%;">How found</td><td style="padding:4px 8px;">${app.how_found || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Training goals</td><td style="padding:4px 8px;">${app.training_goals || '—'}</td></tr>
            <tr><td style="padding:4px 8px;color:#666;">Agreement questions</td><td style="padding:4px 8px;">${app.purchase_agreement_questions || '—'}</td></tr>
            <tr style="background:#fff;"><td style="padding:4px 8px;color:#666;">Other questions</td><td style="padding:4px 8px;">${app.other_questions || 'None'}</td></tr>
          </table>

          <div style="margin-top:1.5rem;padding:1rem;background:#E1F5EE;border-radius:6px;text-align:center;">
            <p style="margin:0;font-size:14px;color:#085041;">Review this application in your admin portal</p>
          </div>
        </div>
      </div>
    `

    // Send to all admins
    await Promise.all(adminEmails.map(email =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
          to: email,
          subject: `New puppy application — ${app.first_name} ${app.last_name}`,
          html
        })
      })
    ))

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})