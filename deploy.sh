#!/bin/bash
# DentAccept — Deploy Edge Functions
# Usage: ./deploy.sh
# Requires: SUPABASE_ACCESS_TOKEN in environment or ~/.zshrc

set -e

PROJECT_REF="wizujykuwlxyfzshoajn"

# Check for access token
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN not set."
  echo ""
  echo "Fix: Add this line to ~/.zshrc:"
  echo "  export SUPABASE_ACCESS_TOKEN=your_token_here"
  echo ""
  echo "Get your token at: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

echo "=== DentAccept — Deploying Edge Functions ==="

npx supabase functions deploy ai-explain       --project-ref $PROJECT_REF
npx supabase functions deploy create-checkout  --project-ref $PROJECT_REF
npx supabase functions deploy stripe-webhook   --project-ref $PROJECT_REF
npx supabase functions deploy customer-portal  --project-ref $PROJECT_REF

echo ""
echo "=== Done ==="
echo "App: https://dentaccept.com/app"
