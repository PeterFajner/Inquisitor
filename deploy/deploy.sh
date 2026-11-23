#!/bin/bash
# Builds locally and ships Inquisitor to asterix. Run from the repo root:
#   deploy/deploy.sh
# Leaves /opt/inquisitor/.env and /opt/inquisitor/data alone. First-time
# setup (user, unit, nginx, TLS) is in DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci --no-audit --no-fund
npm run typecheck
npm test
# The server (tsc, into dist/) and the browser bundle (esbuild, into
# dist/client/, with manifest.json naming its hashed files).
npm run build
test -s dist/client/manifest.json

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -r dist db package.json package-lock.json "$stage/"
mkdir -p "$stage/src" "$stage/deploy" && cp -r src/static "$stage/src/" && cp deploy/*.service "$stage/deploy/"
# Runtime dependencies only: the browser libraries are bundled already.
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

# Code is root's and read-only to the service; only data/ belongs to
# inquisitor, and .env stays root:inquisitor 640.
rsync -az --delete --no-owner --no-group --exclude .env --exclude data "$stage/" asterix:/opt/inquisitor/
ssh asterix "bash -c 'find /opt/inquisitor -path /opt/inquisitor/data -prune -o -exec chown root:root {} + -exec chmod u=rwX,go=rX {} +; chown root:inquisitor /opt/inquisitor/.env; chmod 640 /opt/inquisitor/.env; chown -R inquisitor:inquisitor /opt/inquisitor/data; systemctl restart inquisitor && systemctl --no-pager --lines=8 status inquisitor'"
