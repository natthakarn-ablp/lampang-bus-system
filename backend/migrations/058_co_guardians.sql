-- 058_co_guardians.sql
-- Co-guardians (M2, parent audit 2026-11-08): the parent who bound LINE to a
-- phone (the primary, line_bindings) may invite up to two more LINE accounts —
-- e.g. the other parent — who then see and are notified about the same
-- children. Invites are one-time codes (hash only, 24 h).
--
-- ADDITIVE ONLY. Two new tables; no existing table is altered and no row is
-- written. Nothing reads them until FEATURE_CO_GUARDIAN=true.
-- Rollback: rollback/058_co_guardians_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
CREATE TABLE IF NOT EXISTS line_guardian_invites (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  phone       VARCHAR(20)  NOT NULL,
  code_hash   CHAR(64)     NOT NULL,
  invited_by  VARCHAR(50)  NOT NULL,
  expires_at  TIMESTAMP    NOT NULL,
  used_at     TIMESTAMP    NULL,
  used_by     VARCHAR(50)  NULL,
  revoked_at  TIMESTAMP    NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invite_code (code_hash),
  INDEX idx_invite_phone (phone, used_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS line_co_guardians (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  line_user_id  VARCHAR(50)  NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  invited_by    VARCHAR(50)  NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  bound_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cog_line_user (line_user_id),
  INDEX idx_cog_phone (phone, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
