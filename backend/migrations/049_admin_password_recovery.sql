-- 049_admin_password_recovery.sql
-- Self-service password recovery for high-privilege admin accounts.
-- ADDITIVE ONLY: applying this migration does not modify existing users or
-- enable the runtime feature. Set FEATURE_ADMIN_PASSWORD_RECOVERY=true only
-- after the LINE OA / LIFF administrator verification has passed.

CREATE TABLE IF NOT EXISTS user_recovery_channels (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  user_id          INT NOT NULL,
  provider         ENUM('LINE') NOT NULL,
  provider_subject VARCHAR(100) NOT NULL,
  is_verified      BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recovery_channel_user_provider (user_id, provider),
  UNIQUE KEY uq_recovery_channel_subject (provider, provider_subject),
  CONSTRAINT fk_recovery_channel_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  user_id    INT NOT NULL,
  code_hash  CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  used_at    TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recovery_code_hash (code_hash),
  INDEX idx_recovery_code_user_unused (user_id, used_at),
  CONSTRAINT fk_recovery_code_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id              CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id         INT NOT NULL,
  token_hash      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at      TIMESTAMP NOT NULL,
  used_at         TIMESTAMP NULL,
  delivery_status ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  request_ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  active_user_id  INT GENERATED ALWAYS AS
    (CASE WHEN used_at IS NULL THEN user_id ELSE NULL END) STORED,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_token_hash (token_hash),
  UNIQUE KEY uq_password_reset_one_active_per_user (active_user_id),
  INDEX idx_password_reset_user_active (user_id, used_at, expires_at),
  INDEX idx_password_reset_expiry (expires_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
