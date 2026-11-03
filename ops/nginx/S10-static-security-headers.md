# S10: static-page security headers

This is a candidate for a **bounded operator trial**, not an instruction to
enable an enforced CSP in production. The application already sends Helmet
headers on API responses and has an HTML meta CSP. The public nginx static
response did not send HTTP CSP, `X-Content-Type-Options`, `X-Frame-Options`, or
`Referrer-Policy` when inspected on 3 November 2026. A prior Report-Only trial
recorded ten `script-src-elem` violations for Cloudflare Web Analytics. This
candidate permits its `static.cloudflareinsights.com` beacon. The automatic
beacon posts to the same origin, which `connect-src 'self'` permits.

## Scope and installation review

Use the existing public HTTPS server for `schoolbuslampang.com` and
`www.schoolbuslampang.com`. Copy `static-security-headers-trial.conf` to a
reviewed path under `/etc/nginx/snippets/`. Include it **inside** the public
`location /` and `location /manual/` blocks. Keep `/api/` outside this include
so API headers are not duplicated or replaced. Review the full effective
config with `nginx -T`: `add_header` directives at a child location replace
inherited `add_header` directives on older nginx releases. Preserve any
existing headers from parent contexts explicitly if such directives exist.

Before changing nginx, reserve production on the coordination board, check
health, process, deploy lock and the latest verified DB backup, record exact
config checksums, and copy the original site and snippet files to a private
rollback location. Require a clean `nginx -t` both before and after the edit.
Reload only after syntax succeeds. Run a bounded trial that automatically
restores the exact originals and reloads nginx on failure or timeout. Do not
change Cloudflare rules to compensate for a failed origin trial.

Check public and direct-origin response headers for `/`, `/login`, and
`/manual/`; all should retain HTTP 200 where applicable and show the four
candidate headers. Check that `/api/health` still returns readiness and the
same API Helmet headers. Check unknown routes and error responses because
`always` applies to them. Exercise teacher, school, transport and admin UI in
a dedicated test environment; inspect browser console for CSP violations,
broken fonts, maps, LIFF and Cloudflare beacon. Record only violation types
and resource origins, never user identifiers, URLs with query strings, or
response bodies. Network failures for Google Fonts or OpenStreetMap tiles
must be reported separately from CSP violations.

Do not enforce CSP based on this trial alone. The existing HTML meta CSP allows
`https:` for images and connections; the candidate HTTP policy is narrower.
Any required additional origins need a documented reason and a fresh trial.
Do not add a violation collector without a privacy review. HSTS is omitted
because browsers retain it after nginx rollback; add it in a separate HTTPS
and subdomain review, initially with a short `max-age`, before considering a
long duration. Do not set `includeSubDomains` or `preload` by default.

References: [nginx `add_header` inheritance](https://nginx.org/en/docs/http/ngx_http_headers_module.html),
[Cloudflare Web Analytics CSP](https://developers.cloudflare.com/web-analytics/faq/),
[MDN Report-Only](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only).
