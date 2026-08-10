// supabase/functions/notify-application/index.ts
// Deploy with: supabase functions deploy notify-application
//
// Required secrets (set via Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        — get a free key at resend.com
//   SUPABASE_URL          — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase (needed to query auth.users)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function parseAdminEmails(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const app = await req.json()
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Cloud Peak Silver Labradors <onboarding@resend.dev>'

    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY' }), { status: 500 })
    }

    // Prefer explicit env-configured recipients for predictable delivery.
    let adminEmails = parseAdminEmails(Deno.env.get('ADMIN_EMAILS'))

    if (adminEmails.length === 0) {
      // Fallback: resolve admin emails from profiles + auth.users.
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      const { data: adminProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      if (profilesError) throw new Error('Could not fetch admin profiles: ' + profilesError.message)
      if (!adminProfiles || adminProfiles.length === 0) throw new Error('No admin profiles found')

      const resolved: string[] = []
      for (const profile of adminProfiles) {
        const { data: { user }, error } = await supabase.auth.admin.getUserById(profile.id)
        if (!error && user?.email) resolved.push(user.email.toLowerCase())
      }
      adminEmails = [...new Set(resolved)]
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
    const sendResults = await Promise.all(adminEmails.map(async (email) => {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: email,
          subject: `New puppy application — ${app.first_name} ${app.last_name}`,
          html
        })
      })

      const resendBodyText = await resendRes.text()
      if (!resendRes.ok) {
        return {
          email,
          ok: false,
          status: resendRes.status,
          error: resendBodyText,
        }
      }
      return { email, ok: true, status: resendRes.status }
    }))

    const sentTo = sendResults.filter((r) => r.ok).map((r) => r.email)
    const failedTo = sendResults.filter((r) => !r.ok)

    if (sentTo.length === 0) {
      const firstFailure = failedTo[0]
      throw new Error(`No emails sent. ${firstFailure?.email || 'unknown'} failed: ${firstFailure?.status || ''} ${firstFailure?.error || ''}`)
    }

    return new Response(JSON.stringify({ ok: true, sent_to: sentTo, failed_to: failedTo, send_results: sendResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
