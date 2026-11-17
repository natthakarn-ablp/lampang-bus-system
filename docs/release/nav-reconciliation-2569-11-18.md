# Navigation inventory reconciliation

Base: deployed9fd271537ac4f7d84e242f3f32391bada5009fc6. Existing baseline was100routes/95menus, while deployed App/Sidebar already defined114routes/110menus. This release adds only /updates and /help (public information; no business data or API permission), yielding116routes/110menus. App diff proves only2routes added in this release; Sidebar navigation arrays are unchanged. No old route/menu is removed. Gates remain read-only and missing-baseline still fails.

New-to-baseline routes (2new +14already deployed):
- /updates
- /help
- /school/backdated-attendance
- /school/safe-travel
- /school/vehicle-track
- /school/vehicle-trips
- /school/homeroom-teachers
- /school/year-promotion
- /school/transfer-requests
- /affiliation/users
- /affiliation/vehicle-trips
- /affiliation/vehicle-track
- /province/vehicle-trips
- /province/vehicle-track
- /admin/emergencies
- /admin/vehicle-track

Role menus:
- driver: 11 recorded -> 11 actual; no removals
- school: 17 recorded -> 23 actual; no removals
- affiliation: 15 recorded -> 18 actual; no removals
- province: 16 recorded -> 17 actual; no removals
- transport: 8 recorded -> 8 actual; no removals
- admin: 28 recorded -> 33 actual; no removals
