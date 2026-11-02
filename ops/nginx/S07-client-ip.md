# S07: verified client IP behind Cloudflare and nginx

This is a reviewed configuration candidate. Committing it does not modify the
running nginx configuration. The backend listens on loopback and trusts only a
loopback proxy peer. nginx must supply exactly one verified client address in
`X-Forwarded-For`, or rate limits and audit logs can group users by the edge.

## Before installation

1. Confirm the current DNS proxy setting, any additional proxy in front of
   nginx, and Cloudflare's Pseudo IPv4 mode. If Pseudo IPv4 overwrites
   `CF-Connecting-IP`, resolve that setting before using this header for IPv6.
2. Compare every CIDR in `cloudflare-real-ip.conf` with both current official
   lists at <https://www.cloudflare.com/ips/>. Stop if either list changed;
   update and review the source first. Confirm nginx was built with
   `http_realip_module`.
3. Under operator-entered sudo, inspect the complete effective `nginx -T`.
   Confirm which HTTPS server blocks serve the application and that no other
   `real_ip_header`, `set_real_ip_from`, or `proxy_set_header X-Forwarded-For`
   directive overrides the reviewed setting. Confirm the backend listener is
   loopback-only. Record a sanitized config checksum, health, PM2 process,
   deploy lock, and verified recent database backup before any change.

## Candidate change in each application HTTPS server block

Place the reviewed snippet in an nginx-owned location outside the Git checkout
and include it in each HTTPS server block that proxies `/api/` to the backend:

```nginx
include /etc/nginx/snippets/schoolbus-cloudflare-real-ip.conf;
```

In each corresponding `/api/` location, replace the existing append directive:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
```

The second line is essential: it discards any client-supplied XFF chain. nginx
accepts `CF-Connecting-IP` only when the socket peer matches one of the listed
Cloudflare CIDRs; otherwise `$remote_addr` remains the direct peer. Do not use
`set_real_ip_from 0.0.0.0/0`, `trust proxy: true`, or `$proxy_add_x_forwarded_for`.
Keep the original files and their checksums for rollback. Test with `nginx -t`
before a controlled reload. Do not use `git checkout --detach` for the backend
release; use the reviewed guarded deploy helper on the release branch. The
backend change may be deployed first: until nginx starts overwriting XFF, it
continues to identify the edge as the first untrusted address, matching the
current behavior. Apply and test nginx as a separate bounded operation.

## Acceptance and rollback

Use only synthetic test addresses and no real user data in evidence. Exercise
Cloudflare IPv4 and IPv6 paths, direct-origin access where authorized, a
spoofed client XFF value, and a missing CF header. Record only whether the
derived address equals the expected synthetic client or peer; do not publish
actual addresses, tokens, cookies, or audit rows. Confirm each application
hostname's `/api/health`, rate-limit behavior, and PM2 health after reload.
If a check fails, restore both saved site files and the original snippet state,
run `nginx -t`, reload, and verify health and config checksums again.

The source test checks Express trust of loopback versus non-loopback peers and
the two-address failure mode. It does not prove live nginx behavior. The S07
gate remains open until the operator records the effective config and live
acceptance results.
