import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Map plan names to Stripe Price IDs (set these in Supabase Dashboard > Edge Function Secrets)
const PRICE_IDS: Record<string, string> = {
  starter: Deno.env.get('STRIPE_PRICE_STARTER') || '',
  practice: Deno.env.get('STRIPE_PRICE_PRACTICE') || '',
  group: Deno.env.get('STRIPE_PRICE_GROUP') || '',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { plan, email, office_name } = await req.json()

    if (!plan || !PRICE_IDS[plan]) {
      return new Response(
        JSON.stringify({ error: 'Invalid plan. Use: starter, practice, or group' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if office already exists with this email
    const { data: existingOffice } = await supabaseAdmin
      .from('offices')
      .select('id, stripe_customer_id, status')
      .eq('email', email)
      .single()

    let customerId: string | undefined

    if (existingOffice?.stripe_customer_id) {
      customerId = existingOffice.stripe_customer_id
    }

    // Determine success/cancel URLs from the Origin header
    const origin = req.headers.get('origin') || 'https://dentaccept.com'

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { plan, office_name: office_name || '' },
      },
      success_url: `${origin}/index.html?checkout=success&plan=${plan}`,
      cancel_url: `${origin}/index.html?checkout=cancelled`,
      metadata: { plan, office_name: office_name || '' },
    }

    // Attach existing customer or pre-fill email
    if (customerId) {
      sessionParams.customer = customerId
    } else {
      sessionParams.customer_email = email
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Checkout error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
