# School transport reporting by academic term — confirmed requirements

Status: concept confirmed with owner; NOT implemented or deployed by the school-summary change.

## School workflow

1. After a school account signs in, show a reporting popup for the academic term/year. Derive the default term from the existing authoritative `/api/terms/current` resolver; do not change the global term or silently re-stamp existing student records.
2. Show mutually exclusive choices: has transport / no transport. The owner confirmed that a school with genuinely no transport may submit that status and continue using the system; do not force it to invent a vehicle.
3. If the school declares transport but has no transport data, require the school to add/link its vehicle data before submission. Allow access to the relevant vehicle setup screen so the gate cannot deadlock the user.
4. Submit the confirmation to its affiliation, retaining academic term, school, actor, timestamp and confirmed transport status. Record zero transport explicitly, separately from an absent report.
5. A new academic term requires a new confirmation. Recommended popup policy: require confirmation once per term and reopen while pending, not every login after successful submission. This popup frequency is a proposed default, not yet expressly confirmed.

## Affiliation view and exports

- Show total schools/students and deduplicated vehicles plus per-school rows.
- Add selected term/year and separate reporting states: not yet reported; has transport but needs data; submitted with transport; submitted without transport.
- Do not infer reporting status from a vehicle count of zero, last login, or existence of an old-term student record.
- Keep submitted counts/snapshots separate from live master-data totals and label the basis/date clearly. The current summary feature is live master data only, not a term submission report.
- Exports should carry term/year, school, reporting state, student count, vehicle count and submission timestamp without student/parent PII.

## Scope and safety

- Derive school and affiliation scope on the server; affiliation users cannot choose another affiliation through query/body.
- Exclude grade-teacher accounts from school-wide declarations unless the owner explicitly grants that authority.
- Enforce readiness and allowed current term on the backend, not only with a dismissible frontend popup.
- Preserve operational safety access (emergencies/check-in) when defining any gate; agree the exact permitted actions before enabling enforcement.
- Schema migration, production data writes, deployment, feature enablement and verified backup need separate owner approval. No schema or production business records were changed for this concept.
