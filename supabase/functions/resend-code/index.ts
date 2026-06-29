import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const APP_URL = Deno.env.get('APP_URL') || 'https://dentaccept.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Look up office by email
    const { data: office } = await supabaseAdmin
      .from('offices')
      .select('id, name, status')
      .eq('email', normalizedEmail)
      .single()

    // Always return success to avoid revealing if an email exists
    if (!office || office.status === 'cancelled') {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get active access code
    const { data: accessCode } = await supabaseAdmin
      .from('access_codes')
      .select('code')
      .eq('office_id', office.id)
      .eq('is_active', true)
      .single()

    if (!accessCode || !RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Send email with code
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'DentAccept <welcome@dentaccept.com>',
        to: [normalizedEmail],
        subject: `Your DentAccept access code: ${accessCode.code}`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-family:Georgia,serif;font-size:26px;color:#0f0f0f;margin:0;">
        Dent<em style="color:#1a472a;font-style:italic;">Accept</em>
      </h1>
    </div>
    <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f0f0f;margin:0 0 8px;">Your access code</h2>
      <p style="color:#666;font-size:14px;margin:0 0 24px;">Here is the access code for <strong>${office.name}</strong>:</p>
      <div style="background:#f0faf3;border:1px solid #c8e6d0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#1a472a;margin-bottom:8px;font-weight:600;">Access Code</div>
        <div style="font-family:'SF Mono',Monaco,monospace;font-size:40px;font-weight:700;color:#1a472a;letter-spacing:0.2em;">${accessCode.code}</div>
      </div>
      <div style="text-align:center;">
        <a href="${APP_URL}/app" style="display:inline-block;background:#1a472a;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
          Open DentAccept →
        </a>
      </div>
    </div>
    <div style="text-align:center;margin-top:24px;font-size:12px;color:#999;">
      <p style="margin:0;">Questions? <a href="mailto:hello@dentaccept.com" style="color:#1a472a;">hello@dentaccept.com</a></p>
    </div>
  </div>
</body>
</html>`,
      })
    })

    console.log(`Code resent to ${normalizedEmail}`)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('resend-code error:', err)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
