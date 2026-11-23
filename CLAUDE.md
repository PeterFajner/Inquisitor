# Inquisitor

Warhammer 40k Inquisitor character generator. Two parts:

- `InquisitorCharGen/` — original C# console generator.
- `inquisitor-web/` — Create React App port, deployed as a static site at
  **https://inquisitor.pfaj.ca**.

Fork of `Xwi3/Inquisitor` (`upstream` remote); our fork is `PeterFajner/Inquisitor`.

## Hosting history

- 2023: `inquisitor-web/build` was uploaded to the **one.com** shared webspace
  for pfaj.ca (Apache; the `.htaccess` there just disabled caching on
  `index.html`). That hosting went away when the one.com plan became email-only.
  Backups of what was uploaded: `~/Downloads/inquisitor` (build 2023-07-09) and
  `~/Downloads/inquisitor2` (2023-07-03, has the icons/manifest/robots.txt).
- 2026-10-10: restored on **asterix** (RackNerd VPS, `ssh asterix`) from those
  backups. Purely static, no backend. The AppWrite/login work in the repo
  (commits after 2023-07-09) was never deployed.

## Deployment (asterix)

- Web root: `/var/www/inquisitor` (owner `nginx:nginx`)
- Vhost: `/etc/nginx/conf.d/inquisitor.pfaj.ca.conf` — SPA fallback to
  `index.html`, `index.html` uncached, `static/` immutable for a year.
- TLS: Let's Encrypt via `certbot --nginx`; renews with the host's existing timer.

Redeploy:

```sh
cd inquisitor-web && npm run build
rsync -az --delete build/ asterix:/var/www/inquisitor/
ssh asterix 'bash -c "chown -R nginx:nginx /var/www/inquisitor"'
```

Remote login shell is fish — wrap remote commands in `bash -c "..."`.
asterix has ~1.2 GB RAM; always build locally, never on the server.
