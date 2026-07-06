-- 048_seed_term_windows.sql
-- Populate terms.start_date / terms.end_date so the (new) date-derived term
-- resolver (term.service.deriveTermIdFromDate) has authoritative per-year windows.
-- When today falls inside a window it wins; the October and April–mid-May break
-- GAPS are intentionally NOT covered — a date in a gap resolves to the UPCOMING
-- term via the pure convention (computeTermIdByConvention), matching these dates.
--
-- Thai academic calendar: term 1 = 16 May – 11 Oct, term 2 = 1 Nov – 1 Apr(next yr).
-- Term 2 keeps the STARTING academic-year number (2568-2 = Nov 2025 – Apr 2026).
--
-- ADDITIVE + IDEMPOTENT — re-runnable. Deploys safely AHEAD of the code: the old
-- resolver ignores start_date/end_date, so behaviour is unchanged until the new
-- term.service ships. Does NOT touch is_current (managed by 046 / ops rollover).

INSERT INTO terms (id, name, start_date, end_date) VALUES
  ('2568-1', 'ภาคเรียนที่ 1/2568', '2025-05-16', '2025-10-11'),
  ('2568-2', 'ภาคเรียนที่ 2/2568', '2025-11-01', '2026-04-01'),
  ('2569-1', 'ภาคเรียนที่ 1/2569', '2026-05-16', '2026-10-11'),
  ('2569-2', 'ภาคเรียนที่ 2/2569', '2026-11-01', '2027-04-01')
ON DUPLICATE KEY UPDATE
  name       = VALUES(name),
  start_date = VALUES(start_date),
  end_date   = VALUES(end_date);
