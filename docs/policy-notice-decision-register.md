# Policy notice decision register

Status: **UNDECIDED — labelled production review authorized; legal activation blocked**
Candidate version: `draft-20261018`

This register separates a privacy notice, consent, an operational certification, and an export warning. It is a review template, not legal approval. Do not replace `UNDECIDED` with an assumption.

## Accountable fields

| Field | Decision |
|---|---|
| Data controller / joint controllers | `UNDECIDED` |
| Person accountable for approving the Thai text | `UNDECIDED` |
| Public privacy-rights contact channel | `UNDECIDED` |
| DPO or legal review reference | `UNDECIDED` |
| Effective date and superseded version | `UNDECIDED` |
| Permanent HTTPS URL for the full notice | `UNDECIDED` |

The product owner answered “ยังไม่กำหนด” for the controller, approver and contact channel on 18 October 2026. Later that day the owner authorized deployment of a clearly labelled review draft so the legal team and stakeholders can inspect the real UI before a meeting. The server may return `reviewMode:true`, but it must keep `APPROVED=false`, reject acknowledgement/action-evidence writes and state that browser-only dismissal is not legal evidence.

## Topic decisions required

| Audience / action | Product mechanism | Purpose, lawful basis, recipients, retention | Status |
|---|---|---|---|
| All six staff roles — first use of a materially changed version | Notice + acknowledgement | `UNDECIDED` | Blocked |
| School — pupil and guardian records | Role notice | `UNDECIDED` | Blocked |
| School full account — apply an import batch | Per-batch certification; counts only in evidence | `UNDECIDED` | Blocked |
| School teacher — assigned roster and attendance | Role notice; existing action audit, no popup per tap | `UNDECIDED` | Blocked |
| Driver — assigned roster, attendance, emergency handling and location | Role notice; device location permission remains separate | `UNDECIDED` | Blocked |
| Driver — start an assigned vehicle shift | Per-shift certification; vehicle and session only | `UNDECIDED` | Blocked |
| Transport — vehicle documents and inspection results | Role notice | `UNDECIDED` | Blocked |
| Transport/admin — create or update an inspection result | Per-record certification | `UNDECIDED` | Blocked |
| Transport/admin — export vehicle-safety CSV | Per-export warning; vehicle/inspection fields only | `UNDECIDED` | Blocked |
| Affiliation — schools in its own affiliation | Role notice | `UNDECIDED` | Blocked |
| Province — province-wide aggregate/report work | Role notice | `UNDECIDED` | Blocked |
| School/affiliation/province/admin — download an operational report | Per-export warning bound to report type, period and format | `UNDECIDED` | Blocked |
| Admin — accounts, audit, incident and recovery access | Role notice; action-specific export/incident review still required | `UNDECIDED` | Blocked |
| Admin — export a research package | Per-export warning bound to date range, included sections and format | `UNDECIDED` | Blocked |
| Parent through LINE / public QR | Separate notice and consent analysis | No separate test OA/LIFF exists | Out of this candidate |

## Mandatory review questions for every row

1. Who is the controller for this exact purpose, and who operates only as a processor?
2. What data categories and sources are actually used? Is any sensitive data necessary?
3. What specific purpose and lawful basis applies? A school employee cannot consent on behalf of a child or parent.
4. Who receives the data, through which channel, and is any processor or international transfer involved?
5. How long is the operational data and each evidence record retained, and how is deletion/restriction handled?
6. How can a data subject exercise access, correction, objection, restriction, erasure or portability where applicable?
7. What happens when the user closes or declines the dialog? Safety and emergency functions must remain reachable.
8. Which exact Thai text, version, hash and accessible HTTPS URL were approved?

## Activation gate

Legal activation requires all accountable fields, all in-scope topic rows, a documented review reference, migration backup/rollback, six-role API and browser UAT, 320/375px and keyboard checks, and confirmation that the full notice URL is durable. The labelled review deployment is permitted before those decisions, but it must not write evidence, claim compliance, enable consent, or block operational/emergency work.

`TODO: ตรวจสอบกับผู้เชี่ยวชาญด้านกฎหมาย/ผู้รับผิดชอบคุ้มครองข้อมูลก่อนกรอกฐานกฎหมาย ระยะเวลาเก็บ หรือเปิดใช้งาน`
