import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const APP_URL = Deno.env.get('APP_URL') || 'https://dentaccept.vercel.app'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Generate a random 4-digit access code that doesn't exist yet
async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    const { data } = await supabaseAdmin
      .from('access_codes')
      .select('id')
      .eq('code', code)
      .single()
    if (!data) return code
  }
  // Fallback: 6-digit code
  return String(Math.floor(100000 + Math.random() * 900000))
}

// ========== WELCOME EMAIL ==========
async function sendWelcomeEmail(email: string, officeName: string, code: string, plan: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping welcome email')
    return
  }

  const planLabel = plan === 'group' ? 'Group' : plan === 'practice' ? 'Practice' : 'Starter'
  const appLink = `${APP_URL}/app.html`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:Georgia,serif;font-size:28px;color:#0f0f0f;margin:0;">
        Dent<em style="color:#1a472a;font-style:italic;">Accept</em>
      </h1>
    </div>

    <!-- Main Card -->
    <div style="background:white;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

      <h2 style="font-family:Georgia,serif;font-size:24px;color:#0f0f0f;margin:0 0 8px;">
        Welcome to DentAccept! 🎉
      </h2>
      <p style="color:#666;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Your ${planLabel} plan is active. Here's everything you need to get started.
      </p>

      <!-- Access Code Box -->
      <div style="background:#f0faf3;border:1px solid #c8e6d0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#1a472a;margin-bottom:8px;font-weight:600;">
          Your Access Code
        </div>
        <div style="font-family:'SF Mono',Monaco,monospace;font-size:36px;font-weight:700;color:#1a472a;letter-spacing:0.15em;">
          ${code}
        </div>
        <div style="font-size:13px;color:#666;margin-top:8px;">
          Use this code to log in from any iPad or tablet
        </div>
      </div>

      <!-- Steps -->
      <div style="margin-bottom:24px;">
        <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
          <div style="background:#1a472a;color:white;border-radius:50%;width:24px;height:24px;min-width:24px;text-align:center;line-height:24px;font-size:13px;font-weight:600;margin-right:12px;">1</div>
          <div style="font-size:14px;color:#333;line-height:1.5;">Open <strong>${appLink}</strong> on your iPad or tablet browser</div>
        </div>
        <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
          <div style="background:#1a472a;color:white;border-radius:50%;width:24px;height:24px;min-width:24px;text-align:center;line-height:24px;font-size:13px;font-weight:600;margin-right:12px;">2</div>
          <div style="font-size:14px;color:#333;line-height:1.5;">Enter your access code: <strong>${code}</strong></div>
        </div>
        <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
          <div style="background:#1a472a;color:white;border-radius:50%;width:24px;height:24px;min-width:24px;text-align:center;line-height:24px;font-size:13px;font-weight:600;margin-right:12px;">3</div>
          <div style="font-size:14px;color:#333;line-height:1.5;">Select a procedure and show it to your patient — that's it!</div>
        </div>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${appLink}" style="display:inline-block;background:#1a472a;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
          Open DentAccept →
        </a>
      </div>

      <!-- Divider -->
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

      <!-- Account Details -->
      <table style="width:100%;font-size:13px;color:#666;">
        <tr><td style="padding:4px 0;">Practice</td><td style="text-align:right;color:#333;font-weight:500;">${officeName}</td></tr>
        <tr><td style="padding:4px 0;">Plan</td><td style="text-align:right;color:#333;font-weight:500;">${planLabel}</td></tr>
        <tr><td style="padding:4px 0;">Email</td><td style="text-align:right;color:#333;font-weight:500;">${email}</td></tr>
        <tr><td style="padding:4px 0;">Trial ends</td><td style="text-align:right;color:#333;font-weight:500;">14 days from today</td></tr>
      </table>
    </div>

    <!-- Tips -->
    <div style="margin-top:24px;padding:20px 24px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h3 style="font-size:14px;color:#0f0f0f;margin:0 0 12px;">💡 Pro tips to maximize acceptance rates</h3>
      <ul style="font-size:13px;color:#555;line-height:1.7;margin:0;padding-left:18px;">
        <li>Show the animation <strong>before</strong> discussing price — patients accept what they understand</li>
        <li>Use the "What happens if you wait" section — it's the #1 conversion driver</li>
        <li>Tap 🌐 to switch to Spanish instantly for Hispanic patients</li>
        <li>Bookmark the app on your iPad home screen for one-tap access</li>
      </ul>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:32px;font-size:12px;color:#999;">
      <p style="margin:0 0 4px;">DentAccept — Patients understand it. Patients accept it.</p>
      <p style="margin:0;">Questions? Reply to this email or contact <a href="mailto:hello@dentaccept.com" style="color:#1a472a;">hello@dentaccept.com</a></p>
    </div>
  </div>
</body>
</html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DentAccept <welcome@dentaccept.com>',
        to: [email],
        subject: `Your DentAccept access code: ${code}`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Resend API error:', err)
    } else {
      console.log(`Welcome email sent to ${email}`)
    }
  } catch (err) {
    console.error('Failed to send welcome email:', err)
    // Don't throw — email failure shouldn't block the webhook
  }
}

// Plan -> max tablets mapping
const PLAN_TABLETS: Record<string, number> = {
  starter: 1,
  practice: 3,
  group: 10,
}

serve(async (req) => {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return new Response('Missing signature', { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 })
  }

  console.log(`Processing event: ${event.type}`)

  try {
    switch (event.type) {
      // ========== NEW SUBSCRIPTION (after checkout completes) ==========
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const customerId = session.customer as string
        const subscriptionId = session.subscription as string
        const email = session.customer_details?.email || session.customer_email || ''
        const plan = session.metadata?.plan || 'starter'
        const officeName = session.metadata?.office_name || email.split('@')[0] + "'s Practice"

        // Check if office already exists
        const { data: existing } = await supabaseAdmin
          .from('offices')
          .select('id')
          .eq('email', email)
          .single()

        let officeId: string

        if (existing) {
          // Update existing office
          await supabaseAdmin
            .from('offices')
            .update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              plan,
              max_tablets: PLAN_TABLETS[plan] || 1,
              status: 'active',
              trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('id', existing.id)
          officeId = existing.id
        } else {
          // Create new office
          const { data: newOffice } = await supabaseAdmin
            .from('offices')
            .insert({
              name: officeName,
              email,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              plan,
              max_tablets: PLAN_TABLETS[plan] || 1,
              status: 'active',
              trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .select('id')
            .single()

          officeId = newOffice!.id

          // Generate access code for the new office
          const code = await generateUniqueCode()
          await supabaseAdmin
            .from('access_codes')
            .insert({ office_id: officeId, code })

          console.log(`New office created: ${officeName} (${email}) — code: ${code}`)

          // Send welcome email with access code
          await sendWelcomeEmail(email, officeName, code, plan)
        }
        break
      }

      // ========== SUBSCRIPTION UPDATED (upgrade, downgrade, renewal) ==========
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Find office by Stripe customer ID
        const { data: office } = await supabaseAdmin
          .from('offices')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (!office) {
          console.warn('No office found for customer:', customerId)
          break
        }

        // Map Stripe status to our status
        let status = 'active'
        if (subscription.status === 'past_due') status = 'past_due'
        if (subscription.status === 'canceled' || subscription.status === 'unpaid') status = 'cancelled'
        if (subscription.status === 'trialing') status = 'trial'

        const plan = subscription.metadata?.plan || 'starter'

        await supabaseAdmin
          .from('offices')
          .update({
            status,
            plan,
            max_tablets: PLAN_TABLETS[plan] || 1,
            stripe_subscription_id: subscription.id,
          })
          .eq('id', office.id)

        console.log(`Office ${office.id} updated: status=${status}, plan=${plan}`)
        break
      }

      // ========== SUBSCRIPTION CANCELLED ==========
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const { data: office } = await supabaseAdmin
          .from('offices')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (office) {
          await supabaseAdmin
            .from('offices')
            .update({ status: 'cancelled' })
            .eq('id', office.id)

          // Deactivate access codes
          await supabaseAdmin
            .from('access_codes')
            .update({ is_active: false })
            .eq('office_id', office.id)

          console.log(`Office ${office.id} cancelled — access codes deactivated`)
        }
        break
      }

      // ========== PAYMENT FAILED ==========
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        const { data: office } = await supabaseAdmin
          .from('offices')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (office) {
          await supabaseAdmin
            .from('offices')
            .update({ status: 'past_due' })
            .eq('id', office.id)

          console.log(`Office ${office.id} payment failed — status set to past_due`)
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err)
    // Return 200 anyway so Stripe doesn't retry (we log the error)
    return new Response(JSON.stringify({ received: true, error: (err as Error).message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
