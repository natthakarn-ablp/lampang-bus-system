# Meeting site API access and release notes

The meeting site is published through Codex Sites at
`https://school-bus-uat-meeting-20261021.onlineaway.chatgpt.site`. The Sites
platform publishes the source as a Cloudflare Worker with the `meeting_entries`
D1 binding. The last verified live version before this change was version 9,
source commit `6e0543bef06fb1ea7f065505420a5315acc18f81`. This change has not
been deployed.

## API routes

| Route | Method | Reads or writes | Authentication and role |
|---|---|---|---|
| `/api/entries` | `GET` | Reads meeting entries, including private minutes | Requires a ChatGPT Sites session and a matching ID in `MEETING_SECRETARY_USER_IDS`; unauthenticated requests get 401 and other signed-in users get 403 |
| `/api/entries` | `POST` | Writes feedback, questionnaire entries, or meeting minutes | Requires a ChatGPT Sites session; participants may submit feedback, while only an allowlisted secretary may write decisions, conclusions, owners, due dates, or status changes |

`examples/d1/app/api/notes/route.ts` is an example outside the active `app/api`
router and is not a deployed endpoint. The API route list above covers every
active `route.ts` file in the app.

The session comes from the existing platform-injected authenticated user
headers, read on the server by `getChatGPTUser()`. Set the secretary allowlist
as the comma-separated `MEETING_SECRETARY_USER_IDS` runtime variable; keep its
values out of source and logs. An empty allowlist denies access to the register
and minutes to every user. The browser never supplies or selects a role.

## CSV export

Every exported cell is quoted and embedded quotes are doubled. Values beginning
with `=`, `+`, `-`, `@`, tab, or carriage return are prefixed with an apostrophe
to prevent spreadsheet formula execution.

## Dependency audit

The registry audit before patching reported 11 high and 1 critical advisories.
After the same-major updates to Next `16.4.3`, React/React DOM/React Server DOM
`19.3.1`, Vinext `1.3.1`, Vite `8.3.5`, and the RSC plugin `0.5.37`, the
current lockfile reports 7 high and 0 critical advisories. The fixed Next and
React Server DOM findings are clear in this audit.

Six remaining high findings are in the Cloudflare toolchain (`@cloudflare/vite-plugin`,
Miniflare, Sharp, Undici, Wrangler, and ws). The registry's non-major plugin
fix (`@cloudflare/vite-plugin` `1.66.0`) pulls Wrangler `4.154.0`, whose optional
peer requirement is `@cloudflare/workers-types` major 5; this project pins that
type package to major 4. The toolchain patch is therefore deferred rather than
crossing the requested major boundary or bypassing npm's peer resolution.

The seventh remaining high finding is Zod. The registry offers its fix at Zod
`4.6.7`, a major 4 upgrade; it remains on major 3 pending a separate decision.
There are also 8 moderate findings, including Drizzle Kit whose available audit
fix is marked major. No `npm audit fix --force` was used. This Site PR therefore
records the remaining advisories rather than claiming a clean audit.
