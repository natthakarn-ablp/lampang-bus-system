-- 028_schema_migrations.sql — Phase 10.13A-27
-- Additive: migration tracking so we stop relying on memory for which
-- migrations have been applied. Non-destructive; tracks metadata only.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  checksum CHAR(64) NULL,                -- sha256 of the migration file at record time
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_by VARCHAR(100) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'applied',   -- applied | verified-present-existing | failed
  notes VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
