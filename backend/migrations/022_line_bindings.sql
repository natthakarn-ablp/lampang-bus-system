-- Migration 022 — Phone-based LINE bindings (Round 1)
--
-- Business rule: ผู้ปกครองใน LINE = เบอร์โทรศัพท์
-- One LINE user ⇄ one phone. Children resolved via parents.phone match,
-- so a parent with multiple students sharing the same phone gets all of
-- them via a single binding.
--
-- Round 1 scope: schema + backfill. Caller code (line.service.js) is
-- updated in the same change set. Notification resolver (checkin.service.js)
-- is left untouched and continues to read line_users — line.service.js
-- dual-writes line_users during Round 1 so notifications keep working.

CREATE TABLE IF NOT EXISTS line_bindings (
  id             INT          NOT NULL AUTO_INCREMENT,
  phone          VARCHAR(20)  NOT NULL,
  line_user_id   VARCHAR(80)  NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  bound_at       TIMESTAMP    NULL,
  unbound_at     TIMESTAMP    NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_line_bindings_phone (phone),
  UNIQUE KEY uq_line_bindings_line_user_id (line_user_id),
  KEY idx_line_bindings_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill from the legacy parents.line_user_id column. Same (phone,
-- line_user_id) pair across multiple parent rows (siblings sharing one
-- phone) collapses to a single binding via DISTINCT + ON DUPLICATE KEY.
INSERT INTO line_bindings (phone, line_user_id, is_active, bound_at)
SELECT DISTINCT
       p.phone,
       p.line_user_id,
       TRUE,
       COALESCE(lu.linked_at, NOW())
FROM   parents p
LEFT JOIN line_users lu ON lu.line_user_id = p.line_user_id
WHERE  p.line_user_id IS NOT NULL
  AND  p.line_user_id <> ''
  AND  p.phone IS NOT NULL
  AND  p.phone <> ''
  AND  p.is_deleted = FALSE
ON DUPLICATE KEY UPDATE
  bound_at  = COALESCE(line_bindings.bound_at, VALUES(bound_at)),
  is_active = TRUE;
