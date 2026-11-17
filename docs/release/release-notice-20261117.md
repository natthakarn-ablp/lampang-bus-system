# Release notice — 17 November 2026

Adds a collapsible update notice to authenticated app pages and the linked parent status page. The message is tailored to school, grade teacher, driver, parent, affiliation, province, transport and admin roles. School accounts get a link to classroom attendance. The notice explains bulk time correction, full-day/half-day leave, historical single-round leave and audit behavior.

The notice is informational: no acknowledgement storage, API/DB/LINE writes or permission changes. It is closed by default and omitted on emergency routes to keep urgent tasks clear.

Validation: role-specific browser16/16 (8audiences at390px/1280px), keyboard open/close, minimum48px summary, no overflow/pageerrors/APIcalls; mobile screenshot inspected. Build,labels,hybrid,page-status/route gates anddiffcheck passed. Exact-head and merge-SHA CI/deployment pending.
