#!/usr/bin/env bash
# Creates a Bedrock account. Run this yourself, locally — it prompts for a
# password with input hidden, and that password never appears in your shell
# history or gets typed by anything other than you.
#
# Usage: ./create-account.sh [username]

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SECRET_FILE=".admin-secret.local"
URL_FILE=".worker-url.local"

if [ ! -f "$SECRET_FILE" ]; then
  echo "❌ $SECRET_FILE not found. Run ./deploy-backend.sh first to provision the backend."
  exit 1
fi
if [ ! -f "$URL_FILE" ]; then
  echo "❌ $URL_FILE not found. Run ./deploy-backend.sh first to provision the backend."
  exit 1
fi
ADMIN_SECRET="$(cat "$SECRET_FILE")"
WORKER_URL="$(cat "$URL_FILE")"

USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  read -r -p "Username (e.g. parker): " USERNAME
fi

read -r -s -p "Password (min 8 characters, hidden): " PASSWORD
echo
read -r -s -p "Confirm password: " PASSWORD2
echo
if [ "$PASSWORD" != "$PASSWORD2" ]; then
  echo "❌ Passwords didn't match."
  exit 1
fi

RESPONSE=$(curl -s -X POST "$WORKER_URL/api/admin/create-user" \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")

echo "$RESPONSE"
if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "✅ Account created — sign in from the app (onboarding's last step, or"
  echo "   Settings → Sync any time) with that username and password."
else
  echo "⚠️  Something went wrong — see the response above."
fi
