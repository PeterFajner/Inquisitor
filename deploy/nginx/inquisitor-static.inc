# For Inquisitor's /static/ locations (included from
# inquisitor-app.inc): the icons. Paths aren't versioned, so a day's
# cache, revalidated by ETag after that. (/static/client/ has hashed names
# and its own, longer cache.)
types { text/javascript js mjs; text/css css; application/json json map; image/svg+xml svg; image/png png; image/x-icon ico; font/otf otf; font/woff2 woff2; text/plain txt; }
expires 1d;
error_page 404 = @app;
