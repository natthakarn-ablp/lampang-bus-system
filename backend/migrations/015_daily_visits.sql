-- Daily website visit counter (aggregate-only, minimal footprint)
CREATE TABLE IF NOT EXISTS daily_visits (
  visit_date DATE NOT NULL PRIMARY KEY,
  total_visits INT UNSIGNED NOT NULL DEFAULT 0,
  public_visits INT UNSIGNED NOT NULL DEFAULT 0,
  logged_in_visits INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
