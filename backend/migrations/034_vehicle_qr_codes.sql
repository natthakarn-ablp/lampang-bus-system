-- 034_vehicle_qr_codes.sql — Phase QR-1 (vehicle QR + 3-level access)
-- Additive: a stable, opaque, revocable per-vehicle QR token. The token is a
-- random base64url string (NOT the enumerable V-… id, NOT an expiring JWT — the
-- sticker is physical and cannot rotate per scan). Mapped server-side to the
-- vehicle; revoke by setting qr_revoked_at. Feature is dark until FEATURE_VEHICLE_QR.
--
-- Rollback: ALTER TABLE vehicles DROP COLUMN qr_token, DROP COLUMN qr_revoked_at;
--           (no existing data touched — both columns are additive + nullable)

ALTER TABLE vehicles
  ADD COLUMN qr_token VARCHAR(32) NULL UNIQUE,
  ADD COLUMN qr_revoked_at TIMESTAMP NULL;
