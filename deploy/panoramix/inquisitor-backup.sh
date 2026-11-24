#!/bin/bash
# Nightly backup of Inquisitor, run on panoramix (same pattern as
# speci-backup.sh).
#
# asterix writes a snapshot every night at 04:40 Eastern
# (inquisitor-snapshot.timer: SQLite online backup of the database and a git
# bundle of the rules repo into /opt/inquisitor/data/backups/, 7 of each kept
# there). This job pulls them, gzips each database snapshot once, keeps each
# bundle as it is (already compressed), and copies everything to OneDrive.
#
# The rules repo has no remote and is never pushed to GitHub or anywhere
# else; these bundles are its only off-box copies.
#
# Staged through panoramix rather than running rclone on asterix: asterix is
# internet-facing, so the OneDrive OAuth token is kept off it. Three copies
# exist -- asterix (live, last 7 snapshots), panoramix (staged + archived,
# all), OneDrive.
#
# Every step is ADD-ONLY: rsync without --delete, rclone copy not sync. A
# truncated or corrupted source must never be able to erase good backups.

set -uo pipefail

SRC_HOST="asterix"
SRC_DATA="/opt/inquisitor/data"
STAGE="/mnt/cache/backups/inquisitor-backups"
ARCHIVE="/mnt/cache/backups/inquisitor-archives"
REMOTE="OneDrive:Automated Backups/Inquisitor"
LOG="/var/log/inquisitor-backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "=== start ==="
mkdir -p "$STAGE/backups" "$ARCHIVE"/{db,rules}

# 1. pull snapshots and bundles from asterix (add-only)
if ! rsync -a --timeout=300 -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
        "${SRC_HOST}:${SRC_DATA}/backups/" "$STAGE/backups/" >>"$LOG" 2>&1; then
    log "ERROR: rsync of backups from $SRC_HOST failed -- aborting before touching OneDrive"
    exit 1
fi
log "rsync ok: $(ls -1 "$STAGE"/backups/*.db 2>/dev/null | wc -l) snapshots, $(ls -1 "$STAGE"/backups/*.bundle 2>/dev/null | wc -l) bundles staged"

# 2. gzip any snapshot that doesn't have an archive yet; copy new bundles
made=0
for f in "$STAGE"/backups/inquisitor-*.db; do
    [ -e "$f" ] || continue
    out="$ARCHIVE/db/$(basename "$f").gz"
    [ -f "$out" ] && continue
    if gzip -c "$f" > "$out.part" 2>>"$LOG"; then
        mv "$out.part" "$out"; made=$((made+1))
    else
        rm -f "$out.part"; log "WARN: failed to archive $(basename "$f")"
    fi
done
for f in "$STAGE"/backups/rules-*.bundle; do
    [ -e "$f" ] || continue
    out="$ARCHIVE/rules/$(basename "$f")"
    [ -f "$out" ] && continue
    if cp "$f" "$out.part" 2>>"$LOG"; then
        mv "$out.part" "$out"; made=$((made+1))
    else
        rm -f "$out.part"; log "WARN: failed to archive $(basename "$f")"
    fi
done
log "archived $made new file(s); $(ls -1 "$ARCHIVE/db" | wc -l) snapshots, $(ls -1 "$ARCHIVE/rules" | wc -l) bundles total"

# 3. push to OneDrive (add-only; `copy` never deletes remotely)
ok=1
for d in db rules; do
    if rclone copy "$ARCHIVE/$d" "$REMOTE/$d" \
            --transfers 8 --checkers 16 --contimeout 30s --retries 3 \
            --stats-one-line --stats 0 >>"$LOG" 2>&1; then
        log "rclone copy ok -> $REMOTE/$d"
    else
        log "ERROR: rclone copy to $REMOTE/$d failed (rc=$?)"; ok=0
    fi
done
[ "$ok" = 1 ] || exit 1

log "done: $(du -sh "$ARCHIVE" 2>/dev/null | cut -f1) of archives"
