-- Per-action certification/warning evidence. This is not consent and must not
-- be used to widen permissions. Apply only with migration 052 and before a
-- reviewed policy version is activated.
CREATE TABLE IF NOT EXISTS policy_action_evidence (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  user_role VARCHAR(30) NOT NULL,
  scope_type VARCHAR(30) NULL,
  scope_id VARCHAR(30) NULL,
  action_context VARCHAR(80) NOT NULL,
  evidence_kind ENUM('certification', 'warning') NOT NULL,
  subject_type VARCHAR(50) NOT NULL,
  subject_id VARCHAR(100) NOT NULL,
  notice_key VARCHAR(40) NOT NULL,
  notice_version VARCHAR(40) NOT NULL,
  notice_sha256 CHAR(64) NOT NULL,
  notice_text_snapshot TEXT NOT NULL,
  claim_snapshot TEXT NOT NULL,
  action_token_sha256 CHAR(64) NOT NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  UNIQUE KEY uq_policy_action_token (action_token_sha256),
  INDEX idx_policy_action_subject (action_context, subject_type, subject_id),
  INDEX idx_policy_action_actor (user_id, confirmed_at),
  CONSTRAINT fk_policy_action_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
