# Deploying Inquisitor to asterix

**Preview only.** The new app runs at `preview.inquisitor.pfaj.ca`
(since 2026-11-23); the live `inquisitor.pfaj.ca` still serves the 2023 app
statically from `/var/www/inquisitor` (see CLAUDE.md). The new app replaces
it only once every step in PLAN.md is done (section 3, the switch).

Target: `asterix` (RackNerd VPS, 107.173.210.49, AlmaLinux 8.10, 1.2 GB RAM,
shared with speci and the rest; see `~/code/sandbox/fleet-audit.md`). The app
is one Node process under systemd (`inquisitor.service`), listening on
`127.0.0.1:3010` (speci is on 3007), about 57 MB at start; keep it well
under 100 MB. Remote shells are fish: wrap commands in `bash -c '...'`.

The SQLite database lives in `/opt/inquisitor/data/inquisitor.db`. asterix
already has Node 22.23 (`/usr/bin/node`), which runs the compiled JavaScript
in `dist/` (built by `npm run build`). The browser code is built at the same
time (esbuild, into `dist/client/`), so asterix needs no build tools: Preact
and the rest are dev dependencies, bundled on your machine.

## 1. One-time setup

```bash
ssh asterix
useradd --system --home-dir /opt/inquisitor --shell /sbin/nologin inquisitor
mkdir -p /opt/inquisitor/data && chown -R inquisitor:inquisitor /opt/inquisitor
```

Create `/opt/inquisitor/.env` (root:inquisitor 640, NOT committed):

```
PUBLIC_ORIGIN=https://preview.inquisitor.pfaj.ca   # https://inquisitor.pfaj.ca after the switch
PASSKEY_RP_ID=inquisitor.pfaj.ca                   # passkeys' RP ID, forever
```

`PORT`, `HOST` and `DATABASE_PATH` are set in the unit file. Later steps add
the Luna key (`OPENAI_API_KEY`) and the rules repo path here.

`PASSKEY_RP_ID` (default: `PUBLIC_ORIGIN`'s hostname) is the WebAuthn RP ID:
every passkey is bound to it, so it must never change (a move to another
domain would need Related Origin Requests). The preview host is a subdomain
of it, so passkeys made on the preview keep working after the switch.
Without `PUBLIC_ORIGIN` the server assumes `http://localhost:<PORT>`.

The rules database is `/opt/inquisitor/data/rules` (`RULES_DIR` in the
unit): a copy of the local `data/rules` git repo, owned by `inquisitor`.
First time, after the service user exists:

```bash
rsync -az data/rules/ asterix:/opt/inquisitor/data/rules/
ssh asterix "bash -c 'chown -R inquisitor:inquisitor /opt/inquisitor/data/rules'"
```

From then on the server's copy is the database (edits on the rules page are
commits there); fetch it back with `git -C data/rules pull
ssh://asterix/opt/inquisitor/data/rules` before editing locally, and ship
local commits only while nobody is editing (stop the service, check the
server's copy is clean and at your commit's parent, `rsync -az --delete`,
chown, start; without `--delete` files removed by a commit stay behind as
untracked files and are still loaded).

## 2. Ship it

From the repo, on your machine:

```bash
deploy/deploy.sh
```

It installs, type-checks, tests and builds, stages `dist/`, `src/static/`,
`db/` and the production dependencies, rsyncs them to `/opt/inquisitor/`
(leaving `.env` and `data/` alone), and restarts the service. The first
time, install the unit before running it:

```bash
scp deploy/inquisitor.service asterix:/etc/systemd/system/
ssh asterix "bash -c 'systemctl daemon-reload && systemctl enable inquisitor'"
```

The service runs pending migrations (`dist/scripts/migrate.js`,
`db/migrations/*.sql`, forward only) before starting. Check:

```bash
ssh asterix "bash -c 'curl -s localhost:3010/api/v1/health'"   # {"ok":true}
ssh asterix "bash -c 'journalctl -u inquisitor -n 50 --no-pager'"
ssh asterix "bash -c 'ps -o rss= -C node'"                     # memory, in KB
```

## 3. nginx

asterix uses `/etc/nginx/conf.d/*.conf`. The locations are shared by both
hosts (`inquisitor-app.inc`, included from each server block, with the
icons' `inquisitor-static.inc`); the rate-limit zones are
`inquisitor-zones.conf`. Install those two together: the locations name
the zones (since November 2026, `inquisitor_visitor` limits new visitors
per IP at `/api/v1/account/visitor`; the share-snapshot location and its
`inquisitor_share` zone are gone).

The preview (installed 2026-11-23; certificate via `certbot certonly
--webroot -w /usr/share/nginx/html -d preview.inquisitor.pfaj.ca`):

```bash
scp deploy/nginx/inquisitor-zones.conf deploy/nginx/inquisitor-app.inc deploy/nginx/inquisitor-static.inc deploy/nginx/preview.inquisitor.pfaj.ca.conf asterix:/etc/nginx/conf.d/
ssh asterix "bash -c 'nginx -t && systemctl reload nginx'"
```

The switch: set `PUBLIC_ORIGIN=https://inquisitor.pfaj.ca` in `.env` and
restart the service (the preview host then can't sign in, as passkey
ceremonies check the origin; remove its vhost or point it at the 2023
app). The live
`/etc/nginx/conf.d/inquisitor.pfaj.ca.conf` serves `/var/www/inquisitor`
(SPA fallback); keep a copy, then install the new one, which proxies to the
app and serves the hashed bundle and icons from disk:

```bash
ssh asterix "bash -c 'cp /etc/nginx/conf.d/inquisitor.pfaj.ca.conf /root/inquisitor.pfaj.ca.conf.static-2023'"
scp deploy/nginx/inquisitor.pfaj.ca.conf deploy/nginx/inquisitor-static.inc asterix:/etc/nginx/conf.d/
ssh asterix "bash -c 'nginx -t && systemctl reload nginx'"
```

`inquisitor-static.inc` lives in `conf.d` but isn't loaded on its own (only
`*.conf` is). The certificate already exists (certbot `--nginx`, 2026-10);
check its path matches `ssl_certificate` in the new file
(`certbot certificates`). Renewal: `certbot renew --dry-run --cert-name inquisitor.pfaj.ca`.

Rolling back: put the saved static vhost back and reload nginx; the static
site in `/var/www/inquisitor` is untouched by all of this.

## Accounts

An account is a random id with passkeys; nothing else is stored about it
(`db/migrations/001_accounts.sql`) but when it was made and last used
(`003_visitors.sql`). A visitor is an account with no passkeys, made on a
browser's first save. Not cleaned up yet (revisit at 1 GB); to see how
many there are and how old:

```bash
sudo -u inquisitor node -e "const d=new (require('node:sqlite').DatabaseSync)('/opt/inquisitor/data/inquisitor.db');console.log(d.prepare(\"SELECT count(*) n, min(last_seen_at) oldest FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM account_passkeys p WHERE p.account_id = a.id)\").get())"
```
 Sessions are stored as the SHA-256 of
the cookie. To sign everyone out (in `bash` on asterix):

```bash
sudo -u inquisitor node -e "new (require('node:sqlite').DatabaseSync)('/opt/inquisitor/data/inquisitor.db').exec('DELETE FROM account_sessions')"
```

## Backups

Same pattern as speci: asterix keeps a week of snapshots, panoramix pulls
and archives them, and rclone copies them to OneDrive under
`Automated Backups/Inquisitor`. Every step is add-only, so a broken source
can't erase good backups, and the OneDrive token stays off internet-facing
asterix. The rules repo has no remote and is never mirrored to GitHub: the
bundles are its only off-box copies.

- **asterix, 04:40 Eastern** (`inquisitor-snapshot.timer`, after speci's
  04:30): `dist/scripts/backup.js` (`scripts/backup.ts`) writes a SQLite
  online backup of the database to
  `/opt/inquisitor/data/backups/inquisitor-YYYY-MM-DD.db` (safe while the
  app runs; don't copy `inquisitor.db` itself, it's in WAL mode) and a
  verified `git bundle --all` of the rules repo to `rules-YYYY-MM-DD.bundle`
  beside it; 7 of each kept. A second or so, a few MB of memory.
- **panoramix, 06:15 Atlantic** (05:15 on asterix; `inquisitor-backup.timer`,
  `/root/inquisitor-backup.sh` from `deploy/panoramix/`): rsyncs `backups/`
  into `/mnt/cache/backups/inquisitor-backups/` (add-only), gzips each new
  snapshot and copies each new bundle into
  `/mnt/cache/backups/inquisitor-archives/{db,rules}/`, then `rclone copy`s
  to `OneDrive:Automated Backups/Inquisitor/{db,rules}`. Logs to
  `/var/log/inquisitor-backup.log`.

Install (the snapshot script ships with `deploy/deploy.sh`, in `dist/`):

```bash
scp deploy/inquisitor-snapshot.service deploy/inquisitor-snapshot.timer asterix:/etc/systemd/system/
ssh asterix "bash -c 'systemctl daemon-reload && systemctl enable --now inquisitor-snapshot.timer'"
scp deploy/panoramix/inquisitor-backup.sh panoramix:/root/
scp deploy/panoramix/inquisitor-backup.service deploy/panoramix/inquisitor-backup.timer panoramix:/etc/systemd/system/
ssh panoramix "bash -c 'chmod 700 /root/inquisitor-backup.sh && systemctl daemon-reload && systemctl enable --now inquisitor-backup.timer'"
```

Restore: stop `inquisitor`, put a snapshot (gunzipped) in place of
`/opt/inquisitor/data/inquisitor.db`, remove any `inquisitor.db-wal`/`-shm`;
for the rules, `git clone rules-YYYY-MM-DD.bundle` (check it first with
`git bundle verify` inside any repo) and put the clone at
`/opt/inquisitor/data/rules` (`git remote remove origin` in it, so it stays
remote-less); `chown -R inquisitor:inquisitor /opt/inquisitor/data`, start
`inquisitor`.
