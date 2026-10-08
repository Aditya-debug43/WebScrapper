#!/usr/bin/env bash
#
# DEPLOY THE BACKEND ON THE EC2 HOST
# ==================================
#
# Run ON the server, from anywhere:
#
#   bash ~/WebScrapper/server/deploy/deploy.sh
#
# Idempotent: running it twice does the same thing as running it once. It
# stops at the first failure rather than carrying on, because a half-applied
# deployment is worse than a refused one — in particular, restarting the API
# against a database whose migrations did not apply puts a process in front of
# a schema it does not match.
#
# WHAT IT DELIBERATELY DOES NOT DO:
#
#   - it never runs db:purge-synthetic. Deleting rows is a separate, deliberate
#     decision and must not ride along with a code deployment;
#   - it never seeds. The seed is a load, not an append, and would truncate
#     tables that now hold captured market data;
#   - it never touches .env. Secrets live on the host and nowhere else.

set -euo pipefail

REPO="${REPO:-$HOME/WebScrapper}"
BRANCH="${BRANCH:-main}"
API_SERVICE="${API_SERVICE:-mulya}"

say() { printf '\n\033[1m· %s\033[0m\n' "$*"; }

cd "$REPO"

say "current revision"
git log --oneline -1

say "fetching $BRANCH"
git fetch origin "$BRANCH"

# Refuse to deploy over uncommitted work. On a server that means somebody
# edited a file in place, and a pull would either fail or silently discard it.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "The working tree has uncommitted changes. Resolve them first:" >&2
  git status --short >&2
  exit 1
fi

git checkout "$BRANCH"
git merge --ff-only "origin/$BRANCH"

say "deploying revision"
git log --oneline -1

cd "$REPO/server"

say "installing dependencies"
# `npm ci` honours the lockfile exactly. Dev dependencies are needed because
# the build runs tsc; they are not shipped anywhere.
npm ci

say "building"
npm run build

say "applying migrations"
# Safe to re-run: the runner tracks applied files in __migrations and skips
# anything already there.
npm run db:migrate:prod

say "verifying the dataset"
# 37 structural and provenance checks. A failure here means the schema or the
# seeded baseline moved, which is worth stopping for even though the API would
# probably still serve.
npm run db:verify:prod

say "restarting the API"
sudo systemctl restart "$API_SERVICE"
sleep 3
sudo systemctl is-active --quiet "$API_SERVICE" || {
  echo "The API did not come back. Recent log:" >&2
  sudo journalctl -u "$API_SERVICE" -n 40 --no-pager >&2
  exit 1
}

say "installing the capture timer"
# Re-copied each deploy so a change to the unit file actually lands. Enabling
# an already-enabled timer is a no-op.
sudo cp deploy/mulya-capture.service deploy/mulya-capture.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mulya-capture.timer

say "state"
sudo systemctl is-active "$API_SERVICE" | sed 's/^/  api:    /'
systemctl list-timers mulya-capture.timer --no-pager | sed -n '2p' | sed 's/^/  timer:  /'
curl -fsS http://127.0.0.1:4000/health | sed 's/^/  health: /'
echo

say "deployed"
