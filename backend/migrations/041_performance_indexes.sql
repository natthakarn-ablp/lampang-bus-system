-- Migration 041: Performance indexes for 500-1000 DAU capacity
-- Addresses bottlenecks identified in capacity analysis (2026-06-24)
-- Most indexes already exist from migrations 001-040; this adds the few
-- missing ones that serve hot paths in the Phase 11A tracking services.
--
-- NOTE: MySQL 8 does NOT support `ADD INDEX IF NOT EXISTS` (that is a
-- MariaDB extension). We use plain `ADD INDEX` — these are new indexes
-- that cannot collide on first apply, and the migration runner tracks
-- applied files so re-runs do not occur. For manual idempotency, guard
-- with information_schema.statistics + prepared statement if needed.

-- Route deviations: composite index for the dedup query in emitIfNew:
--   WHERE vehicle_id = ? AND deviation_type = ? AND resolved_at IS NULL
-- The existing idx_rd_vehicle_time covers (vehicle_id, occurred_at) but
-- not the deviation_type + resolved_at filters used by dedup.
ALTER TABLE route_deviations
  ADD INDEX idx_rd_dedup (vehicle_id, deviation_type, resolved_at);

-- geofence_events: composite index for getLastKnownInside (H1 fix):
--   WHERE geofence_id = ? AND vehicle_id = ? ORDER BY occurred_at DESC
-- The existing idx_gfe_geofence_time covers (geofence_id, occurred_at) but
-- not the vehicle_id filter used by the state-derivation query.
ALTER TABLE geofence_events
  ADD INDEX idx_gfe_geofence_vehicle (geofence_id, vehicle_id, occurred_at DESC);
