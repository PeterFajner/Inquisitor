# The app's locations (included from each Inquisitor server block): the
# character builder, inquisitor.service on 127.0.0.1:3010. The app stores no
# IP addresses, so none are passed to it; it checks a write's Origin against
# Host, so Host is the name the browser used.
#
# Static files (scripts, CSS, icons) are served by nginx straight from disk,
# so the app spends no memory on them; anything missing falls through to
# the app.

# No other site may frame these pages (the app sends the same).
add_header X-Frame-Options DENY always;

gzip on;
gzip_proxied any;
gzip_types text/css text/javascript application/javascript application/json image/svg+xml;

location /.well-known/acme-challenge/ { root /usr/share/nginx/html; }

# The browser code and CSS (scripts/client.ts): every file named by its
# content hash, so it never changes and can be cached for good.
location /static/client/ {
    alias /opt/inquisitor/dist/client/;
    types { text/javascript js mjs; text/css css; application/json json; }
    expires max;
    add_header Cache-Control "public, max-age=31536000, immutable";
    error_page 404 = @app;
}
# The icons (src/static/), and the two asked for at the root by name.
location /static/          { alias /opt/inquisitor/src/static/;                             include /etc/nginx/conf.d/inquisitor-static.inc; }
location = /favicon.ico          { alias /opt/inquisitor/src/static/favicon.ico;          include /etc/nginx/conf.d/inquisitor-static.inc; }
location = /apple-touch-icon.png { alias /opt/inquisitor/src/static/apple-touch-icon.png; include /etc/nginx/conf.d/inquisitor-static.inc; }

location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    # A browser's one-time import of the characters it kept itself (2 MB cap in the app).
    client_max_body_size 3m;
    limit_req zone=inquisitor_writes burst=60 nodelay;
    limit_req_status 429;
}
location = /api/v1/account/passkey {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 64k;
    limit_req zone=inquisitor_passkey burst=10 nodelay;
    limit_req_status 429;
}
# A browser's first save makes it a visitor (an account without passkeys):
# new accounts are made only here and at the passkey step, both per-IP limited.
location = /api/v1/account/visitor {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 1k;
    limit_req zone=inquisitor_visitor burst=5 nodelay;
    limit_req_status 429;
}
location = /api/v1/rules/events {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
    limit_conn inquisitor_streams 8;
    limit_conn_status 429;
}

location @app {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
