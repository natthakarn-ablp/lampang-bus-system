-- 055_school_year_promotions.sql
-- One row per school per academic year records that the school admin ran the
-- yearly grade promotion, so a second run in the same year is refused (409).
--
-- ADDITIVE ONLY. One new table; no existing table is altered and no row is
-- written. Nothing reads it until the promotion routes are used. Rolling back
-- is dropping this table (rollback/055_school_year_promotions_rollback.sql).
-- Apply under the production release lock after a backup; never implicitly.
--
-- DATA MINIMISATION: counts only. Individual pupils live in audit_logs.

CREATE TABLE IF NOT EXISTS school_year_promotions (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  school_id        VARCHAR(10)  NOT NULL,
  academic_year    SMALLINT     NOT NULL COMMENT 'Buddhist-era year, e.g. 2569',
  performed_by     INT          NULL,
  promoted_count   INT          NOT NULL DEFAULT 0,
  graduated_count  INT          NOT NULL DEFAULT 0,
  excluded_count   INT          NOT NULL DEFAULT 0,
  unreadable_count INT          NOT NULL DEFAULT 0,
  performed_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_school_year (school_id, academic_year),
  CONSTRAINT fk_syp_school FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
