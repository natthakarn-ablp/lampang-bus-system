-- Migration 011: Add password_changed_at for full session invalidation
-- When a user changes their password, this timestamp is set to NOW().
-- Any refresh token with iat < password_changed_at is rejected.

ALTER TABLE users
  ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT NULL AFTER must_change_password;
