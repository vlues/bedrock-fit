#!/usr/bin/env bash
# Provisions and deploys the Bedrock backend: a Cloudflare Worker + D1
# database that holds your Anthropic API key server-side and syncs each
# account's profile across devices. Idempotent — safe to re-run any time
# you change worker code, or just to redeploy.
#
# The ONLY thing you'll be asked for is your Anthropic API key, typed at a
# hidden prompt. It's piped straight into `wrangler secret put` and never
# written to any file on disk. Everything else — the D1 database, the
# admin secret that gates account creation, your GitHub Pages origin, your
# Cloudflare login — is auto-provisioned or handled by a browser login flow
# you approve yourself.
#
# Usage:
#   ./deploy-backend.sh
#
# Requires: node/npx, git. `gh` is optional (used to auto-detect your
# GitHub Pages origin — it'll ask if `gh` isn't set up).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

command -v npx >/dev/null || { echo "❌ Node.js (npx) is not installed. Install from https://nodejs.org first."; exit 1; }

# ---------------------------------------------------------------------
# 1. Figure out your GitHub Pages origin (for ALLOWED_ORIGIN / CORS)
# ---------------------------------------------------------------------
ORIGIN=""
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  OWNER="$(gh api user --jq .login 2>/dev/null || true)"
  if [ -n "$OWNER" ]; then
    ORIGIN="https://$OWNER.github.io"
    echo "🔎 Auto-detected GitHub Pages origin: $ORIGIN"
  fi
fi
if [ -z "$ORIGIN" ]; then
  read -r -p "Your GitHub Pages URL (e.g. https://you.github.io): " ORIGIN
fi
ORIGIN="${ORIGIN%/}"

TMP="$(mktemp)"
sed -E "s#(\"ALLOWED_ORIGIN\": \")[^\"]*(\")#\1${ORIGIN},http://localhost:8124\2#" wrangler.jsonc > "$TMP"
mv "$TMP" wrangler.jsonc
echo "✅ wrangler.jsonc → ALLOWED_ORIGIN = $ORIGIN,http://localhost:8124"

# ---------------------------------------------------------------------
# 2. Cloudflare login (browser-based, you approve it yourself)
# ---------------------------------------------------------------------
if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  echo "🔐 Not logged in to Cloudflare — opening browser login..."
  npx --yes wrangler login
fi

# ---------------------------------------------------------------------
# 3. D1 database — create once, reuse on re-runs
# ---------------------------------------------------------------------
if grep -q '"database_id": "REPLACE_ME"' wrangler.jsonc; then
  echo "🗄  Creating D1 database bedrock-db..."
  CREATE_OUT="$(npx --yes wrangler d1 create bedrock-db)"
  echo "$CREATE_OUT"
  DB_ID="$(echo "$CREATE_OUT" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  if [ -z "$DB_ID" ]; then
    echo "❌ Couldn't parse the new database_id from wrangler's output — paste it into wrangler.jsonc by hand and re-run."
    exit 1
  fi
  sed -i.bak "s#\"database_id\": \"REPLACE_ME\"#\"database_id\": \"$DB_ID\"#" wrangler.jsonc
  rm -f wrangler.jsonc.bak
  echo "✅ wrangler.jsonc → database_id = $DB_ID"
else
  echo "ℹ️  D1 database already provisioned (wrangler.jsonc has a real database_id)"
fi

echo "🗄  Applying schema..."
npx --yes wrangler d1 execute bedrock-db --remote --file schema.sql

# ---------------------------------------------------------------------
# 4. Admin secret — gates account creation. Machine-generated, not a
#    personal password, so it's fine to create and set automatically.
# ---------------------------------------------------------------------
if [ ! -f .admin-secret.local ]; then
  echo "🔑 Generating admin secret (gates create-account.sh, not a personal login)..."
  ADMIN_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(24))' 2>/dev/null || openssl rand -hex 24)"
  printf '%s' "$ADMIN_SECRET" > .admin-secret.local
fi
printf '%s' "$(cat .admin-secret.local)" | npx --yes wrangler secret put ADMIN_SECRET

# ---------------------------------------------------------------------
# 5. Your Anthropic API key — the one field. Hidden input, piped straight
#    into wrangler's encrypted secret store, never touches a file here.
# ---------------------------------------------------------------------
echo ""
echo "Paste your Anthropic API key (input hidden, get one at https://console.anthropic.com/settings/keys):"
read -r -s ANTHROPIC_KEY
echo ""
if [ -z "$ANTHROPIC_KEY" ]; then
  echo "❌ No key entered — aborting."
  exit 1
fi
printf '%s' "$ANTHROPIC_KEY" | npx --yes wrangler secret put ANTHROPIC_API_KEY
unset ANTHROPIC_KEY

# ---------------------------------------------------------------------
# 6. Deploy
# ---------------------------------------------------------------------
echo "🚀 Deploying worker..."
DEPLOY_OUT="$(npx --yes wrangler deploy)"
echo "$DEPLOY_OUT"
WORKER_URL="$(echo "$DEPLOY_OUT" | grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)"
if [ -z "$WORKER_URL" ]; then
  echo "⚠️  Deployed, but couldn't auto-detect the worker URL from wrangler's output."
  echo "   Look for it above (ends in .workers.dev), save it to .worker-url.local,"
  echo "   and paste it into js/sync.js's BACKEND_URL constant by hand."
  exit 0
fi
printf '%s' "$WORKER_URL" > .worker-url.local
echo "✅ Backend live at: $WORKER_URL"

# ---------------------------------------------------------------------
# 7. Point the site at the backend
# ---------------------------------------------------------------------
SYNC_JS="$REPO_ROOT/js/sync.js"
# Matches either the pristine `null` (first-ever run) or an already-quoted
# URL (re-runs, e.g. after redeploying the worker under a new name).
if [ -f "$SYNC_JS" ] && grep -Eq "const BACKEND_URL = (null|'[^']*');" "$SYNC_JS"; then
  sed -i.bak -E "s#const BACKEND_URL = (null|'[^']*');#const BACKEND_URL = '$WORKER_URL';#" "$SYNC_JS"
  rm -f "$SYNC_JS.bak"
  echo "✅ js/sync.js now points at your backend"
else
  echo "⚠️  Couldn't find js/sync.js's BACKEND_URL to patch automatically. Set it by hand to: $WORKER_URL"
fi

# ---------------------------------------------------------------------
# 8. Redeploy the static site with the patched sync.js, if deploy.sh exists
# ---------------------------------------------------------------------
if [ -x "$REPO_ROOT/deploy.sh" ]; then
  echo ""
  echo "🌐 Redeploying the site with the updated sync.js..."
  (cd "$REPO_ROOT" && ./deploy.sh)
fi

echo ""
echo "──────────────────────────────────────────────────────────"
echo "🎉 Backend live at: $WORKER_URL"
echo ""
echo "Next — create an account for each person who should have one:"
echo "  cd cloudflare-worker && ./create-account.sh yourname"
echo "It prompts for a password with input hidden — nothing is echoed/logged."
echo ""
echo "Once signed in (onboarding's last step, or Settings → Sync any time),"
echo "each person's data backs up automatically and Bedrock's AI features"
echo "switch on — no key entry anywhere on any device, ever."
echo "──────────────────────────────────────────────────────────"
