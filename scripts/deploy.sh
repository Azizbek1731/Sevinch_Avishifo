#!/usr/bin/env bash
# One-shot deploy to the AviShifo EC2 box.
#   ./scripts/deploy.sh            # sync + clean-build + restart + health check
#   ./scripts/deploy.sh --migrate  # also run prisma migrate deploy
#
# Requires ~/avishifo.pem. Clean-builds on the server (rm dist/.next) so a
# partial rsync or stale incremental cache can never ship an old bundle.
set -euo pipefail

HOST="${DEPLOY_HOST:-46.8.194.85}"
USER="${DEPLOY_USER:-ubuntu}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${DEPLOY_DIR:-/srv/avishifo}"
SSH_OPTS="-i ${KEY} -o ServerAliveInterval=15 -o ConnectTimeout=20"

# The AWS box still runs four OTHER projects and still has a stale copy of this
# one. Shipping there would migrate a dead database and resurrect an API that
# long-polls the same Telegram token as the live one.
if [ "${HOST}" = "16.16.120.67" ]; then
  echo "REFUSING: 16.16.120.67 is the retired box — AviShifo now lives on 46.8.194.85." >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_ssh() { ssh ${SSH_OPTS} "${USER}@${HOST}" "$@"; }

echo "==> [1/4] rsync code → ${HOST} (retry on transient drops)"
for attempt in 1 2 3 4 5; do
  if rsync -az --delete \
      --exclude .git --exclude node_modules --exclude .next --exclude dist \
      --exclude .turbo --exclude .local-run --exclude uploads \
      --exclude .env --exclude '.env.local' --exclude '.env.*.local' --exclude .keys \
      --exclude test-results --exclude playwright-report --exclude coverage \
      -e "ssh ${SSH_OPTS}" "${ROOT}/" "${USER}@${HOST}:${REMOTE_DIR}/"; then
    echo "    rsync ok"; break
  fi
  echo "    rsync attempt ${attempt} failed; retrying in 10s..."; sleep 10
  [ "${attempt}" = 5 ] && { echo "rsync failed 5×, aborting"; exit 1; }
done

echo "==> [2/4] install deps + prisma client"
run_ssh "cd ${REMOTE_DIR} && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm --filter @avishifo/api db:generate >/dev/null 2>&1 && echo deps-ok"

echo "==> [3/4] clean build (rm dist/.next → no stale bundles) — a few minutes"
# NEXT_PUBLIC_* are inlined at BUILD time and Next.js only reads env files inside
# apps/<app>/, never the repo-root .env — so the root .env must be sourced into
# the build shell or settings like NEXT_PUBLIC_DEMO_LOGINS silently keep their
# defaults no matter what the server's .env says.
run_ssh "cd ${REMOTE_DIR} && export NODE_OPTIONS=--max-old-space-size=1536 && \
  set -a && [ -f .env ] && . ./.env; set +a && \
  rm -rf apps/*/dist apps/*/.next apps/*/*.tsbuildinfo packages/*/dist packages/*/*.tsbuildinfo && \
  for pkg in shared api web display portal; do \
    echo \"  building \$pkg...\"; pnpm --filter @avishifo/\$pkg build >/dev/null 2>&1 || { echo \"BUILD FAILED: \$pkg\"; exit 1; }; \
  done && echo build-ok"

if [ "${1:-}" = "--migrate" ]; then
  # Right before the restart, not before the build: the old code keeps serving
  # during the build, and minutes of old code against a migrated schema is how
  # money rows quietly stop linking. This shrinks that window to seconds. No
  # pipe after the command — a masked migrate failure ships code against the
  # old schema, which is worse than a loud abort.
  echo "==> [3b] prisma migrate deploy"
  run_ssh "cd ${REMOTE_DIR}/apps/api && npx prisma migrate deploy"
fi

echo "==> [4/4] restart pm2 + health check"
# The API needs ~10-20s to boot on the 2GB box (Nest + Prisma + Redis + the
# Telegram long poll). A fixed sleep reported a failure on every deploy that was
# in fact fine, so poll until it answers instead.
# Name the four apps explicitly: `pm2 restart all` would also restart every
# unrelated project sharing this pm2 daemon, and would start ones deliberately
# left stopped.
run_ssh "cd ${REMOTE_DIR} && pm2 restart avishifo-api avishifo-web avishifo-display avishifo-portal --update-env >/dev/null 2>&1 && pm2 save >/dev/null 2>&1 && \
  for i in \$(seq 1 30); do \
    out=\$(curl -s -m 5 http://localhost:3001/api/v1/health 2>/dev/null) && [ -n \"\$out\" ] && { echo \"\$out\"; exit 0; }; \
    sleep 2; \
  done; echo 'HEALTH CHECK TIMED OUT after 60s'; pm2 logs --nostream --lines 20 --err; exit 1"
echo ""
echo "==> done. External check:"
curl -s -m 10 "http://${HOST}/api/v1/health" && echo ""
