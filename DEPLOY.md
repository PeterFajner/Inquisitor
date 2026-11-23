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

From then on the server's copy is the database (edits on the canvas are
commits there); fetch it back with `git -C data/rules pull
ssh://asterix/opt/inquisitor/data/rules` before editing locally, and ship
local commits only while nobody is editing (stop the service, rsync, chown,
start).

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
`inquisitor-zones.conf`.

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
(`db/migrations/001_accounts.sql`). Sessions are stored as the SHA-256 of
the cookie. To sign everyone out (in `bash` on asterix):

```bash
sudo -u inquisitor node -e "new (require('node:sqlite').DatabaseSync)('/opt/inquisitor/data/inquisitor.db').exec('DELETE FROM account_sessions')"
```

## Backups (to do before the switch)

Same pattern as speci: a nightly SQLite online backup on asterix into
`/opt/inquisitor/data/backups/` (don't copy `inquisitor.db` itself while the
app runs: it's in WAL mode), pulled by panoramix and copied to OneDrive,
add-only. The rules repo (`data/rules`, step 1) is backed up the same way and
never mirrored to GitHub.
