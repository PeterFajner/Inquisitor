#!/bin/bash
# Runs the end-to-end suite (test/e2e) on panoramix instead of this machine,
# then copies its results back. Run from the repo root, with the suite's
# options (default: everything, 2 shards at a time):
#   deploy/panoramix/e2e.sh
#   deploy/panoramix/e2e.sh --shard 'ui:*' --jobs 2
# Ships the working tree as it is (uncommitted changes too) and data/ (the
# rules repo and the book's pages; not the database). On panoramix it runs
# as user inqe2e in /mnt/cache/inquisitor-e2e (Node in node/, the tree in
# repo/), at low priority so Frigate and the media stack keep their share.
# Results land in .e2e/panoramix/<time>/ and are summarised at the end.
set -euo pipefail
cd "$(dirname "$0")/../.."

host=panoramix
base=/mnt/cache/inquisitor-e2e
stamp=$(date +%Y%m%d-%H%M%S)
[ $# -gt 0 ] || set -- --all --jobs 2

rsync -az --delete \
  --exclude /.git --exclude /node_modules --exclude /dist --exclude /.e2e --exclude /legacy \
  --exclude /data/inquisitor.db\* --exclude /data/balance --exclude /data/reports \
  ./ "$host:$base/repo/"

args=$(printf '%q ' "$@")
status=0
ssh "$host" "bash -c 'set -e
chown -R inqe2e:inqe2e $base/repo
cd $base/repo
run() { sudo -u inqe2e env HOME=$base TMPDIR=$base/tmp PATH=$base/node/bin:/usr/bin:/bin \"\$@\"; }
# Dependencies again only when the lockfile changed.
if ! cmp -s package-lock.json $base/package-lock.installed; then
  run npm ci --no-audit --no-fund
  cp package-lock.json $base/package-lock.installed
fi
find $base/tmp -mindepth 1 -maxdepth 1 -mmin +720 -exec rm -rf {} +
run nice -n 15 ionice -c 3 npm run e2e -- $args --results $base/results/$stamp'" || status=$?

mkdir -p .e2e/panoramix
rsync -az "$host:$base/results/$stamp/" ".e2e/panoramix/$stamp/" || true
node --disable-warning=ExperimentalWarning test/e2e/summary.ts ".e2e/panoramix/$stamp" || true
echo "results: .e2e/panoramix/$stamp (exit $status)"
exit $status
