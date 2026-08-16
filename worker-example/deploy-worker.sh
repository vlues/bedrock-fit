#!/usr/bin/env bash
# Deploys the optional Cloudflare Worker proxy so your Anthropic API key
# never touches the browser (see README "Optional: hide your API key
# behind a real backend"). Idempotent — safe to re-run.
#
# The ONLY thing you'll be asked for is your Anthropic API key, typed at a
# hidden prompt. It's piped straight into `wrangler secret put` and never
# written to any file on disk. Everything else (your GitHub Pages URL,
# your Cloudflare login) is auto-detected or handled by a browser login
# flow you approve yourself.
#
# Usage:
#   ./deploy-worker.sh
#
# Requires: node/npx, git, gh (for auto-detecting your Pages URL — optional,
# it'll ask if gh isn't set up).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

command -v npx >/dev/null || { echo "❌ Node.js (npx) is not installed. Install from https://nodejs.org first."; exit 1; }

# ---------------------------------------------------------------------
# 1. Figure out your GitHub Pages URL (for ALLOWED_ORIGIN / CORS lockdown)
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
ORIGIN="${ORIGIN%/}" # strip trailing slash

# Write it into wrangler.jsonc (only non-secret config, safe to commit)
TMP="$(mktemp)"
sed "s#\"https://REPLACE_ME.github.io/bedrock-fit\"#\"$ORIGIN\"#; s#\"ALLOWED_ORIGIN\": \"https://[^\"]*\"#\"ALLOWED_ORIGIN\": \"$ORIGIN\"#" wrangler.jsonc > "$TMP"
mv "$TMP" wrangler.jsonc
echo "✅ wrangler.jsonc → ALLOWED_ORIGIN = $ORIGIN"

# ---------------------------------------------------------------------
# 2. Cloudflare login (browser-based, you approve it yourself)
# ---------------------------------------------------------------------
if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  echo "🔐 Not logged in to Cloudflare — opening browser login..."
  npx --yes wrangler login
fi

# ---------------------------------------------------------------------
# 3. Your Anthropic API key — the one field. Hidden input, piped straight
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
# 4. Deploy
# ---------------------------------------------------------------------
echo "🚀 Deploying worker..."
DEPLOY_OUT="$(npx --yes wrangler deploy)"
echo "$DEPLOY_OUT"
WORKER_URL="$(echo "$DEPLOY_OUT" | grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)"
if [ -z "$WORKER_URL" ]; then
  echo "⚠️  Deployed, but couldn't auto-detect the worker URL from wrangler's output."
  echo "   Look for it above (ends in .workers.dev) and paste it into js/api.js's"
  echo "   PROXY_ENDPOINT constant by hand, then re-run ../deploy.sh."
  exit 0
fi
echo "✅ Worker live at: $WORKER_URL"

# ---------------------------------------------------------------------
# 5. Point the site at the proxy
# ---------------------------------------------------------------------
API_JS="$REPO_ROOT/js/api.js"
if grep -q "const PROXY_ENDPOINT = null;" "$API_JS"; then
  sed -i.bak "s#const PROXY_ENDPOINT = null;#const PROXY_ENDPOINT = '$WORKER_URL';#" "$API_JS"
  rm -f "$API_JS.bak"
  echo "✅ js/api.js now points at your worker"
elif grep -q "const PROXY_ENDPOINT = '" "$API_JS"; then
  sed -i.bak "s#const PROXY_ENDPOINT = '[^']*';#const PROXY_ENDPOINT = '$WORKER_URL';#" "$API_JS"
  rm -f "$API_JS.bak"
  echo "✅ js/api.js PROXY_ENDPOINT updated to your latest worker URL"
else
  echo "⚠️  Couldn't find PROXY_ENDPOINT in js/api.js to patch automatically."
  echo "   Set it by hand to: $WORKER_URL"
fi

# ---------------------------------------------------------------------
# 6. Redeploy the static site with the patched api.js, if deploy.sh exists
# ---------------------------------------------------------------------
if [ -x "$REPO_ROOT/deploy.sh" ]; then
  echo ""
  echo "🌐 Redeploying the site with the updated api.js..."
  (cd "$REPO_ROOT" && ./deploy.sh)
fi

echo ""
echo "──────────────────────────────────────────────────────────"
echo "🎉 Done. Every phone using this site now goes through your worker —"
echo "nobody's key is ever in a browser. Individual API-key entry in"
echo "Settings is no longer needed (or used)."
echo ""
echo "To go back to per-device keys later: set PROXY_ENDPOINT back to"
echo "null in js/api.js and re-run ../deploy.sh."
echo "──────────────────────────────────────────────────────────"
