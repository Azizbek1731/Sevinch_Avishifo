#!/usr/bin/env bash
# One-shot deploy to the AviShifo EC2 box.
#   ./scripts/deploy.sh            # sync + clean-build + restart + health check
#   ./scripts/deploy.sh --migrate  # also run prisma migrate deploy
#
# Requires ~/avishifo.pem. Clean-builds on the server (rm dist/.next) so a
# partial rsync or stale incremental cache can never ship an old bundle.
set -euo pipefail

HOST="${DEPLOY_HOST:-16.16.120.67}"
USER="${DEPLOY_USER:-ubuntu}"
KEY="${DEPLOY_KEY:-$HOME/avishifo.pem}"
REMOTE_DIR="/home/${USER}/avishifo"
SSH_OPTS="-i ${KEY} -o ServerAliveInterval=15 -o ConnectTimeout=20"
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

if [ "${1:-}" = "--migrate" ]; then
  echo "==> [2b] prisma migrate deploy"
  run_ssh "cd ${REMOTE_DIR}/apps/api && npx prisma migrate deploy 2>&1 | tail -2"
fi

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

echo "==> [4/4] restart pm2 + health check"
run_ssh "cd ${REMOTE_DIR} && pm2 restart all --update-env >/dev/null 2>&1 && pm2 save >/dev/null 2>&1 && sleep 5 && curl -s -m 8 http://localhost:3001/api/v1/health"
echo ""
echo "==> done. External check:"
curl -s -m 10 "http://${HOST}/api/v1/health" && echo ""
