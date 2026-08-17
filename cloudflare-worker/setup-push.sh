#!/usr/bin/env bash
# ============================================================================
# Bedrock — one-time Web Push (VAPID) setup
#
# Generates a P-256 VAPID keypair with node's crypto and stores it as worker
# secrets, then applies the schema (push_subscriptions table) and redeploys.
# Run from cloudflare-worker/:   ./setup-push.sh
#
# After this: users who tap "Turn on notifications" in the app (installed to
# their Home Screen on iOS) get a daily lock-screen brief written from their
# own synced data. Cron schedule lives in wrangler.jsonc ("triggers").
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "node is required (used only to generate the keypair)"; exit 1; }
command -v npx  >/dev/null || { echo "npx (npm) is required for wrangler"; exit 1; }

echo "→ Generating VAPID P-256 keypair…"
KEYS_JSON=$(node - <<'EOF'
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privJwk = privateKey.export({ format: 'jwk' });
const pubJwk = publicKey.export({ format: 'jwk' });
const b64uToBuf = (s) => Buffer.from(s, 'base64url');
// Client + VAPID header both want the uncompressed point: 0x04 || X || Y
const uncompressed = Buffer.concat([Buffer.from([4]), b64uToBuf(pubJwk.x), b64uToBuf(pubJwk.y)]);
console.log(JSON.stringify({ publicKey: uncompressed.toString('base64url'), privateJwk: privJwk }));
EOF
)
PUBLIC_KEY=$(node -e "console.log(JSON.parse(process.argv[1]).publicKey)" "$KEYS_JSON")
PRIVATE_JWK=$(node -e "console.log(JSON.stringify(JSON.parse(process.argv[1]).privateJwk))" "$KEYS_JSON")

read -r -p "Contact email for VAPID (push services may use it to reach you about problems): " VAPID_EMAIL
VAPID_EMAIL=${VAPID_EMAIL:-bedrock@example.com}

echo "→ Storing worker secrets…"
printf '%s' "$PRIVATE_JWK" | npx wrangler secret put VAPID_PRIVATE_JWK
printf '%s' "$PUBLIC_KEY"  | npx wrangler secret put VAPID_PUBLIC_KEY
printf '%s' "mailto:$VAPID_EMAIL" | npx wrangler secret put VAPID_SUBJECT

echo "→ Applying schema (push_subscriptions table)…"
npx wrangler d1 execute bedrock-db --remote --file=./schema.sql

echo "→ Redeploying worker (picks up the cron trigger)…"
npx wrangler deploy

echo ""
echo "✓ Push is live. On an iPhone: add Bedrock to the Home Screen, open it,"
echo "  sign in, and tap 'Turn on notifications' when offered (or in Settings)."
echo "  The daily brief lands at the hour set in wrangler.jsonc (06:00 UTC)."
