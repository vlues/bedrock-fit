#!/usr/bin/env bash
# Wires up Fitbit sync via the Google Health API (Fitbit's old Web API was
# retired in favor of this — see developers.google.com/health). Optional,
# and separate from deploy-backend.sh — run that one first.
#
# Google's OAuth client for this API is a confidential "Web application"
# type (needs a client secret), so — unlike the old Fitbit integration —
# there's real Google Cloud Console setup to do by hand first. This script
# only handles the Cloudflare half; the two fields it asks for (Client ID,
# Client Secret) come from steps 1-6 below.
#
# Usage:
#   ./setup-google-health.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v npx >/dev/null || { echo "❌ Node.js (npx) is not installed. Install from https://nodejs.org first."; exit 1; }
[ -f .worker-url.local ] || { echo "❌ Run ./deploy-backend.sh first (this needs your worker already deployed)."; exit 1; }
WORKER_URL="$(cat .worker-url.local)"
CALLBACK_URL="${WORKER_URL}/api/google-health/callback"

SITE_URL=""
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  OWNER="$(gh api user --jq .login 2>/dev/null || true)"
  [ -n "$OWNER" ] && SITE_URL="https://$OWNER.github.io/bedrock-fit"
fi
if [ -z "$SITE_URL" ]; then
  read -r -p "Your deployed Bedrock site URL (e.g. https://you.github.io/bedrock-fit): " SITE_URL
fi
SITE_URL="${SITE_URL%/}"

cat <<EOF

──────────────────────────────────────────────────────────
Google Cloud Console setup (one-time, ~5 minutes) — this part
can't be scripted, it's your Google account:

1. Create or pick a project:  https://console.cloud.google.com/projectcreate
2. Enable the Google Health API for it:
   https://console.cloud.google.com/apis/library/health.googleapis.com
3. OAuth consent screen (https://console.cloud.google.com/auth/overview):
     User type: External
     Publishing status: Testing   ← keeps you under the 100-user cap, no
                                    Google security review needed for a
                                    2-person household app
4. Audience page (https://console.cloud.google.com/auth/audience):
     Add yourself + anyone else who'll connect a Fitbit as "Test users"
     (their Google account email — the one their Fitbit/Pixel data is under)
5. Data Access page (https://console.cloud.google.com/auth/scopes):
     Add these two scopes:
       https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
       https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
6. Credentials → Create Credentials → OAuth client ID
   (https://console.cloud.google.com/apis/credentials):
     Application type: Web application
     Authorized redirect URI — paste EXACTLY:
       $CALLBACK_URL
   Copy the Client ID and Client Secret it gives you — paste them below.
──────────────────────────────────────────────────────────

EOF

read -r -p "Google OAuth Client ID: " GOOGLE_CLIENT_ID
if [ -z "$GOOGLE_CLIENT_ID" ]; then echo "❌ No Client ID entered — aborting."; exit 1; fi
echo "Google OAuth Client Secret (input hidden):"
read -r -s GOOGLE_CLIENT_SECRET
echo ""
if [ -z "$GOOGLE_CLIENT_SECRET" ]; then echo "❌ No Client Secret entered — aborting."; exit 1; fi

printf '%s' "$GOOGLE_CLIENT_ID" | npx --yes wrangler secret put GOOGLE_CLIENT_ID
printf '%s' "$GOOGLE_CLIENT_SECRET" | npx --yes wrangler secret put GOOGLE_CLIENT_SECRET
unset GOOGLE_CLIENT_SECRET
printf '%s' "$CALLBACK_URL" | npx --yes wrangler secret put GOOGLE_HEALTH_REDIRECT_URI
printf '%s' "$SITE_URL" | npx --yes wrangler secret put SITE_URL

echo "🚀 Redeploying worker..."
npx --yes wrangler deploy

echo ""
echo "──────────────────────────────────────────────────────────"
echo "🎉 Google Health is wired up."
echo ""
echo "Each person: sign in under Settings → Sync (if not already), then"
echo "Settings → Connect Fitbit. Google's consent screen only lets in"
echo "accounts you added as a Test user in step 4 above."
echo "──────────────────────────────────────────────────────────"
