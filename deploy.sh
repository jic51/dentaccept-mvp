#!/bin/bash
# DentAccept — Deploy Script
# Run from the DentAcceptMVP/ directory

set -e

echo "=== DentAccept Deploy ==="

# 1. Deploy frontend to Vercel
echo "[1/4] Deploying to Vercel..."
npx vercel --prod

# 2. Deploy all Supabase Edge Functions
echo "[2/4] Deploying Edge Functions..."
supabase functions deploy ai-explain
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook

# 3. Remind about secrets
echo "[3/4] Secrets checklist (set via: supabase secrets set KEY=VALUE):"
echo "  - ANTHROPIC_API_KEY       (for AI explanations)"
echo "  - STRIPE_SECRET_KEY       (for checkout + webhooks)"
echo "  - STRIPE_WEBHOOK_SECRET   (from Stripe dashboard)"
echo "  - STRIPE_PRICE_STARTER    (Stripe Price ID for $79/mo)"
echo "  - STRIPE_PRICE_PRACTICE   (Stripe Price ID for $129/mo)"
echo "  - STRIPE_PRICE_GROUP      (Stripe Price ID for $249/mo)"

# 4. Remind about Stripe webhook
echo "[4/4] Stripe webhook setup:"
echo "  Go to: Stripe Dashboard > Developers > Webhooks"
echo "  Endpoint: https://<your-project>.supabase.co/functions/v1/stripe-webhook"
echo "  Events: checkout.session.completed, customer.subscription.updated,"
echo "          customer.subscription.deleted, invoice.payment_failed"

echo ""
echo "=== Deploy complete ==="
echo "Landing: https://dentaccept.com"
echo "App:     https://dentaccept.com/app.html"
