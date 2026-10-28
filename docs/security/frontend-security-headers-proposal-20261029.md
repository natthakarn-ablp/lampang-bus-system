# Frontend security headers proposal — 2026-10-29

## Status and scope

**Active production headers: NOT VERIFIED in this repository.** This is a
staging-first proposal only. It does not edit nginx, Cloudflare, the frontend
meta CSP, or production configuration.

`docs/deployment-hardening.md` says nginx serves the SPA directly and describes
security headers as a future operator action. `frontend/index.html` already
contains a meta CSP, so the absence of an HTTP response header must not be
described as the absence of all CSP protection. The actual production response
headers, static-file origin, and active nginx/Cloudflare rules were not read in
this code-only review.

## Sources observed in the frontend

- Same-origin API calls use `/api` (`frontend/src/api/axios.js`).
- The current meta CSP permits `https://static.line-scdn.net` for scripts,
  Google Fonts origins for styles/fonts, and broad HTTPS for images and
  connections.
- The LIFF SDK is imported by the frontend utility and its network behavior
  must be observed in staging; do not assume its full endpoint set from the
  import alone.
- Four map components load tiles from `https://{s}.tile.openstreetmap.org`.
- Google Maps URLs are ordinary outbound links and do not by themselves need a
  CSP source permission.
- Sarabun font files are preloaded from `/fonts/`.

## Rollout

1. Capture the current headers for `/`, a hashed JS asset, a font, and a map
   tile through each production hostname. Keep the captures with timestamp and
   release SHA, excluding cookies and authorization data. This step is still
   NOT VERIFIED.
2. In a non-production environment, add `Content-Security-Policy-Report-Only`
   at the layer that serves the SPA. Do not replace or tighten the existing
   meta CSP in the first phase. Report-only violations must not block page
   behavior.
3. Start with the candidate policy below. Collect only the directive and
   normalized source origin from reports; discard full URLs, query strings,
   referrers, IP addresses, cookies, and request bodies. Apply short retention
   and a rate limit. Do not send reports to a third party without approval.
4. Exercise the full school, driver, affiliation, province, admin, map, and LIFF
   flows in staging with mock/synthetic accounts. Review each violation and
   allow an origin only when source and observed behavior require it.
5. After a release review, enforce the approved policy in staging first. Keep
   the previous header value as the rollback artifact. Production activation
   requires a separate operator-reviewed change and `nginx -t` before reload.

## Candidate Content-Security-Policy-Report-Only

This is a starting point for staging. It is not an approved production policy.

```text
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'self';
form-action 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.line-scdn.net;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob: https://*.tile.openstreetmap.org;
connect-src 'self' https://api.line.me https://liff.line.me https://*.tile.openstreetmap.org;
```

`frame-ancestors` is enforced from an HTTP header; a meta CSP cannot provide
that directive. The current application uses inline/eval allowances in its
meta policy. Do not remove them in this proposal until a staging build proves
they are unnecessary. Similarly, the explicit LINE `connect-src` entries are
only a source-informed starting point; the LIFF flow may reveal additional
required endpoints. Do not restore broad `https:` permissions without recording
the observed need.

## Other response headers

For staging responses, evaluate these at the SPA-serving layer and confirm
they do not conflict with any application-level header:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=300
```

Send HSTS only over HTTPS. Begin with a short `max-age`; after a reviewed
observation period, increase gradually. Do not add `includeSubDomains` or
`preload` until every subdomain and rollback implication has been reviewed.
Do not infer that the existing API's Helmet headers protect HTML or assets
served directly by nginx.

## Staging checks and rollback

- `curl -sS -D - -o /dev/null https://<staging-host>/` records the HTML response
  headers; repeat for a JS asset and font. Use a synthetic staging hostname.
- Browser checks cover a clean load, route navigation, map tiles, API reads,
  LIFF login, and font rendering. Record CSP directives and normalized blocked
  origins without recording user identifiers or full URLs.
- Confirm that report-only violations never turn a request into a blocked
  resource and that unsupported source requirements are understood before
  enforcement.
- Roll back by removing the report-only header at the same serving layer. If
  an enforced policy has later been approved, restore the saved prior policy
  and verify the same staging flows before any production action.

No staging or production header verification is claimed by this document.
