# Proxy trust assessment — 2026-10-29

## Status

**Production client-IP behavior: NOT VERIFIED.** This change records the
source-level discrepancy and a safe verification plan. It does not alter
Express proxy trust, nginx, Cloudflare, firewall rules, or production.

## Repository evidence

- `backend/src/app.js` sets `app.set('trust proxy', 1)`.
- The adjacent comment describes `client → Cloudflare → nginx (127.0.0.1) →
  backend` and says nginx appends the Cloudflare edge address to
  `X-Forwarded-For`, leaving `<client>, <cf-edge>`.
- The source comment's conclusion that one trusted hop exposes `<client>` is
  not established by that description alone. Express's numeric hop count is
  applied from the socket peer; with the stated chain, hop count `1` may expose
  the rightmost forwarded address (the edge) instead of the client. A spoofed
  leftmost XFF value can also matter if the edge does not replace/sanitize it.
- No active nginx configuration or reviewed Cloudflare CIDR list is tracked in
  this repository. `docs/deployment-hardening.md` describes proxy headers but
  does not establish the deployed `real_ip` and `proxy_set_header` directives.
  The existing system-audit note likewise asks the owner to confirm those
  directives. Therefore the actual socket peer, header chain, and
  `req.ip` observed in production remain NOT VERIFIED.

## Synthetic Supertest observations

`backend/tests/proxyTrustHopCount.unit.test.js` copies the actual Express
`trust proxy` setting from `backend/src/app.js` into a probe app and reports
both `req.ip` and the socket peer. The table below records the behavior
verified by Supertest. `peer` means the probe's `req.socket.remoteAddress`;
these tests exercise Express hop semantics only and do not establish which
peer or headers nginx supplies in production.

| Client-supplied headers in the synthetic request | `req.ip` with `trust proxy = 1` | Interpretation |
|---|---|---|
| none | socket `peer` | No forwarded address is trusted; Express uses the direct peer. |
| `X-Forwarded-For: 198.51.100.77` | `198.51.100.77` | A single XFF value is accepted when the socket peer occupies the one trusted hop. This is a hop-semantics result, not proof this request can reach production. |
| `X-Forwarded-For: 198.51.100.77, 203.0.113.24` | `203.0.113.24` | Express selects the rightmost forwarded value for one trusted hop; the leftmost value is not selected. |
| `CF-Connecting-IP: 198.51.100.77` only | socket `peer` | Express does not read this header directly. |
| `X-Real-IP: 198.51.100.77` only | socket `peer` | Express does not read this header directly. |
| `Forwarded: for=198.51.100.77` only | socket `peer` | Express does not read this header directly. |
| `X-Forwarded-For: 198.51.100.77, 203.0.113.24` plus `CF-Connecting-IP: 198.51.100.88` | `203.0.113.24` | `req.ip` follows XFF; the separate CF header does not override it. |
| `X-Forwarded-For: 2001:db8::77, 2001:db8::24` | `2001:db8::24` | IPv6 uses the same rightmost-value behavior. |

The test is synthetic and intentionally makes no claim that any of these
header combinations was observed on the production host. Exact active nginx
`real_ip`/`proxy_set_header` settings, the socket peer, Cloudflare CIDRs,
origin reachability, and production `req.ip` remain **NOT VERIFIED**.

## Required configuration evidence before changing the trust setting

An operator with server access should capture, without secrets:

1. The active nginx `server` and `/api/` `location` blocks for every production
   hostname, including the exact `set_real_ip_from`, `real_ip_header`,
   `real_ip_recursive`, and `proxy_set_header X-Forwarded-For` directives.
2. Whether the backend listener is reachable only through the expected nginx
   peer, including the actual peer address seen by Node.
3. The current Cloudflare proxy setting for each public DNS record and the
   authoritative Cloudflare IPv4/IPv6 CIDR list used by nginx. Do not copy an
   unreviewed list or trust all private networks.
4. A controlled staging observation of `req.ip` and the socket peer for the
   cases below. Do not log authorization headers, cookies, tokens, or student
   data.

## Recommended target, after evidence is available

- Configure nginx to accept `CF-Connecting-IP` only from the reviewed
  Cloudflare CIDRs; use those same CIDRs in `set_real_ip_from` and enable
  recursive real-IP resolution only when the reviewed topology requires it.
- Make nginx send a fresh `X-Forwarded-For` derived from the verified client
  address rather than append an arbitrary client-supplied chain. Preserve the
  forwarding protocol and host deliberately.
- Restrict direct-origin access to the reviewed proxy path. If the backend is
  local to nginx, accept only the verified loopback peer and configure Express
  to trust that peer; if they are separated, use only the reviewed proxy
  CIDRs. Do not use `trust proxy: true`, a broad hop count, or all private
  ranges.
- Deploy the nginx and application changes together only after staging proves
  the same behavior for IPv4 and IPv6. Keep a tested rollback copy of both
  configurations.

The exact allowlist and final Express setting are intentionally unspecified
until the active topology is reviewed. Guessing them could either corrupt
rate-limit/audit IP attribution or trust spoofable forwarding headers.

## Staging verification matrix

| Request path | Input | Expected result |
|---|---|---|
| Through Cloudflare and nginx | Known synthetic client address; edge sets verified client header | `req.ip` equals the synthetic client |
| Through Cloudflare and nginx | Client sends a forged leftmost XFF value | Forged value is discarded; `req.ip` remains the verified client |
| Direct to origin | Forged XFF from an untrusted peer | Connection is denied, or `req.ip` remains the direct peer and is never treated as the client identity |
| Through IPv6 proxy path | Synthetic IPv6 client and reviewed IPv6 edge range | `req.ip` equals the synthetic IPv6 client |
| Repeated requests | Two distinct synthetic client addresses | Rate-limit buckets differ and audit metadata contains only the resolved address |

Record the app SHA, nginx config revision, the four observed `req.ip` results,
and the result of `nginx -t`. Keep staging values synthetic. This repository
does not contain evidence that these checks have been run against production.
