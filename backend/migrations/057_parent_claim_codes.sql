-- 057_parent_claim_codes.sql
-- One-time LINE bind codes a school issues per pupil and hands to the parent
-- on paper (M3, parent audit 2026-11-08). Proves "the school gave this person
-- the code", which a phone number + student code cannot.
--
-- ADDITIVE ONLY. One new table; no existing table is altered and no row is
-- written. Only SHA-256 of a code is stored, never the code itself. Nothing
-- reads or writes it until FEATURE_PARENT_CLAIM_CODE=true.
-- Rollback: rollback/057_parent_claim_codes_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
CREATE TABLE IF NOT EXISTS parent_claim_codes (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  student_id  INT          NOT NULL,
  code_hash   CHAR(64)     NOT NULL,
  issued_by   INT          NOT NULL,
  issued_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP    NOT NULL,
  used_at     TIMESTAMP    NULL,
  used_by     VARCHAR(50)  NULL,
  revoked_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_claim_code (code_hash),
  INDEX idx_claim_student (student_id, revoked_at, used_at),
  CONSTRAINT fk_pcc_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_pcc_issued_by FOREIGN KEY (issued_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
