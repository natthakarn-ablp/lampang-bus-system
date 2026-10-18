-- Staff privacy-notice acknowledgements are distinct from consent_records.
-- Apply before approving a notice version. No production notice is approved by
-- this migration. Rollback only while empty: DROP TABLE policy_acknowledgements;
CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  user_role VARCHAR(30) NOT NULL,
  scope_type VARCHAR(30) NULL,
  scope_id VARCHAR(30) NULL,
  notice_key VARCHAR(40) NOT NULL,
  notice_version VARCHAR(40) NOT NULL,
  notice_sha256 CHAR(64) NOT NULL,
  notice_text_snapshot TEXT NOT NULL,
  acknowledged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_policy_ack_user_key_version (user_id, notice_key, notice_version),
  INDEX idx_policy_ack_version (notice_key, notice_version),
  CONSTRAINT fk_policy_ack_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
