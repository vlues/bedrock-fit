#!/usr/bin/env bash
# Publishes bedrock-fit/ to GitHub Pages. Idempotent — safe to re-run any
# time you want to push changes; it reuses the existing repo instead of
# failing on subsequent runs.
#
# Zero fields to fill in: it uses your already-authenticated GitHub CLI
# (`gh`) to figure out your username and create/update the repo.
#
# Usage:
#   ./deploy.sh
#
# Requires: git, gh (authenticated — run `gh auth login` once if needed).

set -euo pipefail

REPO_NAME="bedrock-fit"
BRANCH="main"

# ---------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------
command -v git >/dev/null || { echo "❌ git is not installed."; exit 1; }
command -v gh  >/dev/null || { echo "❌ GitHub CLI (gh) is not installed. Install: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ Not logged in to GitHub CLI. Run: gh auth login"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OWNER="$(gh api user --jq .login)"
echo "🔐 Authenticated as: $OWNER"

# ---------------------------------------------------------------------
# 1. git init / commit
# ---------------------------------------------------------------------
if [ ! -d .git ]; then
  git init -q
  git checkout -q -b "$BRANCH"
  echo "📦 Initialized git repo in $SCRIPT_DIR/"
fi

if ! git config user.email >/dev/null 2>&1; then
  git config user.email "$(gh api user --jq '.email // (.login + "@users.noreply.github.com")')"
  git config user.name  "$(gh api user --jq '.name // .login')"
fi

git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "✅ Committed changes"
else
  echo "ℹ️  Nothing new to commit"
fi

# ---------------------------------------------------------------------
# 2. Create the repo (first run) or push to it (subsequent runs)
# ---------------------------------------------------------------------
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "ℹ️  Repo $OWNER/$REPO_NAME already exists — pushing update"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  git push -q -u origin "$BRANCH"
else
  echo "🆕 Creating $OWNER/$REPO_NAME (public repo — required for free GitHub Pages)"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
fi

# ---------------------------------------------------------------------
# 3. Enable GitHub Pages, serving from the branch root
# ---------------------------------------------------------------------
echo "🌐 Enabling GitHub Pages..."
if gh api "repos/$OWNER/$REPO_NAME/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$OWNER/$REPO_NAME/pages" \
    -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null
else
  gh api -X POST "repos/$OWNER/$REPO_NAME/pages" \
    -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null
fi

PAGES_URL="https://$OWNER.github.io/$REPO_NAME/"

# ---------------------------------------------------------------------
# 4. Wait for the first build to go live
# ---------------------------------------------------------------------
echo "⏳ Waiting for the site to build..."
for i in $(seq 1 24); do
  STATUS="$(gh api "repos/$OWNER/$REPO_NAME/pages" --jq .status 2>/dev/null || echo "")"
  if [ "$STATUS" = "built" ]; then
    echo "✅ Build complete"
    break
  fi
  sleep 5
done

echo ""
echo "──────────────────────────────────────────────────────────"
echo "🎉 Live at: $PAGES_URL"
echo ""
echo "This is a PUBLIC repo (GitHub Pages requires that on a free plan) —"
echo "the source code and this URL are visible to anyone who finds them."
echo "Nothing sensitive lives in the repo itself: each person's Anthropic"
echo "API key stays in their own browser's localStorage, never committed."
echo ""
echo "Next: open the URL above on each phone, run onboarding once, and"
echo "'Add to Home Screen' so it behaves like an app."
echo ""
echo "Want your Claude key off the device entirely instead of pasted into"
echo "Settings? Run worker-example/deploy-worker.sh once — see that"
echo "script or README.md 'Optional: hide your API key behind a real"
echo "backend' for details."
echo "──────────────────────────────────────────────────────────"
