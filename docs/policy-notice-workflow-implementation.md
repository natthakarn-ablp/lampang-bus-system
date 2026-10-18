# Role-based policy notice candidate

Status: **draft, disabled**. This change does not approve a legal basis, display a notice in production, grant consent, or change existing access rights.

The staff routes cover school, driver, transport, affiliation, province, and admin. Each receives the common topic and one role topic. The server determines the role from the authenticated token and rejects a different topic or an obsolete version. Acknowledgements have their own append-only table (`052_policy_acknowledgements.sql`) and a required audit entry. They are separate from QR/LINE `consent_records`; pressing “รับทราบ” must never be interpreted as consent. The modal offers “อ่านภายหลัง” and is suppressed on emergency paths. The server currently returns `enabled:false`, and POST refuses writes, because `APPROVED` remains false.

Before a responsible controller can approve and activate a version, record and review for each activity:

1. The actual controller, DPO/contact channel, data categories and source, purpose and lawful basis, recipients, retention/deletion rule, rights channel, and any international transfer.
2. The full Thai text and its accessible permanent URL. The role summary in `policyNotices.js` is a draft and is insufficient alone. Version and hash must cover the exact complete text shown.
3. Which actions need a notice, which need a separate certification, and which (if any) truly require consent. School staff cannot consent on behalf of a child or parent.
4. A safe migration/rollback, six-role browser and API UAT, keyboard/mobile tests, and human review of the actual text. Parent LIFF and QR remain separate and cannot be signed off without a separate test environment.

Activation must be a separate reviewed change after those decisions. `APPROVED` is computed from the review fields, a full-notice URL, body text, lawful basis and retention rule for every topic; changing one boolean is insufficient. The ledger stores the exact notice snapshot and its hash. Do not deploy this draft as a legal notice or enable QR/LINE flags to make this dialog appear.
