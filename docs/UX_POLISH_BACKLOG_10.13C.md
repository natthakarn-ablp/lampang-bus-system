# UX Polish Backlog — 10.13C

Low-priority polish gathered from the 10.13B build + 10.13C-1 rollout. **Not
scheduled** — implement only when explicitly instructed. Each item is small and
non-breaking.

| # | Item | Why | Effort | Notes |
|---|------|-----|--------|-------|
| 1 | Standalone school **vehicle-request history** view | Today the school sends a restore request from an import row but has no dedicated place to track it; the `GET /school/vehicles/requests` endpoint already exists. | S | Mirror `StudentTransferModal`'s request-history list. |
| 2 | Vehicle-request action on **ImportHistory** rows | The "ขอกู้คืนรถ" action lives only on ImportPreview rows; a reopened batch in history can't trigger it. | S | Reuse the same handler in `ImportHistoryModal`. |
| 3 | Clearer **VEHICLE_NOT_FOUND** next-step copy | Current copy points to "จัดการรถ"; could deep-link to the vehicle add form with the plate prefilled. | S | Prefill plate from `input_vehicle_plate`. |
| 4 | **Admin dashboard quick-links** | One-click access to pending work. | M | Cards: imports needing action · vehicle requests pending · transfer requests pending · driver-integrity warnings (counts from existing endpoints). |
| 5 | School-side **pre-import checklist** | Reduce malformed uploads (province on plates, required columns, no in-file duplicate codes). | S | Static panel above the upload button. |
| 6 | Surface **operations health** WARN summary on admin home | Admins see system health without opening the dedicated page. | S | Small banner from `GET /admin/operations/health`. |

**Triage note:** Items 1–3 + 5 are pure front-end (no migration, low risk). Item 4
+ 6 read existing admin endpoints. None require schema changes. Promote any to a
phase only on explicit request.
