import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

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
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret)
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
