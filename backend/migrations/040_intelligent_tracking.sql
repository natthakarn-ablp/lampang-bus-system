-- ════════════════════════════════════════════════════════════════════════════
-- Migration 040 — Intelligent Tracking Layer (ETA + Geofencing + Route Deviation)
-- Phase 11A • 2026-06-23
--
-- Adds three interconnected capabilities that share the existing GPS feed
-- (vehicle_latest_locations) and pickup_points:
--
--   1. vehicle_location_history — append-only GPS trail (enables ETA
--      prediction + route replay; the MVP table was latest-only).
--   2. geofences + geofence_events — virtual polygons around schools /
--      pickup points; auto-generates enter/exit events that trigger
--      LINE notifications to parents + school alerts.
--   3. route_baselines + route_deviations — learns each vehicle's typical
--      timing per session and flags off-route / late vehicles to school
--      + province + admin.
--   4. eta_predictions — cached ETA per (vehicle, pickup_point, session,
--      date) so parent/school/admin dashboards read cheap.
--
-- All four features are feature-flagged (FEATURE_ETA, FEATURE_GEOFENCE,
-- FEATURE_ROUTE_DEVIATION) and dark by default. When the flags are off the
-- existing system is byte-for-byte unchanged.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. vehicle_location_history — append-only GPS trail
-- ────────────────────────────────────────────────────────────────────────────
-- One row per GPS ping. Retained for ETA learning + route replay.
-- A scheduled cleanup (scripts/prune-location-history.sh) keeps the table
-- bounded: rows older than LOCATION_HISTORY_RETENTION_DAYS (default 30)
-- are deleted nightly. Index supports the two hot read paths:
--   * ETA: latest N pings for (vehicle_id, recorded_at DESC)
--   * Replay: all pings for (vehicle_id, date)
CREATE TABLE IF NOT EXISTS vehicle_location_history (
  id              BIGINT        AUTO_INCREMENT PRIMARY KEY,
  vehicle_id      VARCHAR(20)   NOT NULL,
  driver_id       INT           NULL,
  latitude        DECIMAL(10,8) NOT NULL,
  longitude       DECIMAL(11,8) NOT NULL,
  accuracy_meters INT           NULL,
  speed_mps       FLOAT         NULL,
  heading_deg     FLOAT         NULL,
  recorded_at     TIMESTAMP(3)  NOT NULL,
  received_at     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source          ENUM('web','line') NOT NULL DEFAULT 'web',
  -- FK policy: RESTRICT (default) — consistent with the rest of the schema.
  -- The app uses soft-delete exclusively (is_deleted=TRUE), so hard-deletes
  -- of vehicles/drivers should never happen in normal operation. RESTRICT
  -- ensures that if a hard-delete is ever attempted, it fails loudly instead
  -- of silently cascading telemetry rows without an audit trail. PDPA
  -- purges of child/driver data are handled explicitly via dedicated
  -- scripts that respect the retention policy.
  CONSTRAINT fk_vlh_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_vlh_driver  FOREIGN KEY (driver_id)  REFERENCES drivers(id),
  INDEX idx_vlh_vehicle_time (vehicle_id, recorded_at DESC),
  INDEX idx_vlh_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. geofences — virtual polygons
-- ────────────────────────────────────────────────────────────────────────────
-- A geofence is a circular zone (center + radius_meters) for simplicity and
-- fast haversine checks. polygon_geojson is reserved for future migration
-- to arbitrary shapes; the service uses radius_meters today.
--
-- target_type:
--   SCHOOL        — surrounds a school (entry = arrived at school)
--   PICKUP_POINT  — surrounds a single pickup_points row
--   DEPOT         — surrounds a vehicle depot / driver start point
--
-- trigger_on: which transition(s) fire events + notifications.
--   ENTER  — vehicle enters the zone
--   EXIT   — vehicle leaves the zone
--   BOTH   — both
--
-- notify_roles: comma-separated role codes that receive an alert
--   (e.g. "parent,school" or "school,province").
CREATE TABLE IF NOT EXISTS geofences (
  id              INT           AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(120)  NOT NULL,
  target_type     ENUM('SCHOOL','PICKUP_POINT','DEPOT') NOT NULL,
  target_id       INT           NULL,           -- schools.id or pickup_points.id
  vehicle_id      VARCHAR(20)   NULL,            -- NULL = applies to all vehicles;
                                                 -- set = scoped to one vehicle
  center_lat      DECIMAL(10,8) NOT NULL,
  center_lng      DECIMAL(11,8) NOT NULL,
  radius_meters   INT           NOT NULL DEFAULT 150,
  trigger_on      ENUM('ENTER','EXIT','BOTH') NOT NULL DEFAULT 'BOTH',
  notify_roles    VARCHAR(120)  NOT NULL DEFAULT 'parent,school',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  polygon_geojson JSON          NULL,            -- reserved for future shapes
  created_by      INT           NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- FK policy: RESTRICT — consistent with the rest of the schema (soft-delete
  -- model). If the scoped vehicle is ever hard-deleted, the geofence must be
  -- explicitly reassigned or removed first.
  CONSTRAINT fk_gf_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  INDEX idx_gf_target (target_type, target_id, is_active),
  INDEX idx_gf_vehicle (vehicle_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- geofence_events — append-only log of enter/exit transitions.
-- A (geofence_id, vehicle_id, event_type='ENTER') row is created only on the
-- transition from "outside" to "inside"; the service tracks last-known state
-- per (geofence, vehicle) to avoid duplicate events.
CREATE TABLE IF NOT EXISTS geofence_events (
  id              BIGINT        AUTO_INCREMENT PRIMARY KEY,
  geofence_id     INT           NOT NULL,
  vehicle_id      VARCHAR(20)   NOT NULL,
  driver_id       INT           NULL,
  event_type      ENUM('ENTER','EXIT') NOT NULL,
  latitude        DECIMAL(10,8) NOT NULL,
  longitude       DECIMAL(11,8) NOT NULL,
  occurred_at     TIMESTAMP(3)  NOT NULL,
  received_at     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  notifications_sent INT        NOT NULL DEFAULT 0,
  -- geofence_id CASCADE is intentional: geofence_events are meaningless
  -- without the parent geofence, and geofences are config (not PII).
  CONSTRAINT fk_gfe_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE CASCADE,
  -- vehicle_id RESTRICT — consistent with the rest of the schema.
  CONSTRAINT fk_gfe_vehicle  FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id),
  INDEX idx_gfe_geofence_time (geofence_id, occurred_at DESC),
  INDEX idx_gfe_vehicle_time (vehicle_id, occurred_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. route_baselines — learned typical timing per vehicle / session
-- ────────────────────────────────────────────────────────────────────────────
-- One row per (vehicle_id, session, day_of_week). Updated by a nightly job
-- that aggregates the last N days of GPS history + geofence_events into
-- typical start/end times and a polyline of waypoints (the "expected path").
--
-- The deviation service compares today's progress against this baseline:
--   * if the vehicle is > DEVIATION_RADIUS_M off the expected polyline → OFF_ROUTE
--   * if the vehicle is > DELAY_THRESHOLD_MIN behind the typical timing → LATE
CREATE TABLE IF NOT EXISTS route_baselines (
  id              INT           AUTO_INCREMENT PRIMARY KEY,
  vehicle_id      VARCHAR(20)   NOT NULL,
  session         ENUM('morning','evening') NOT NULL,
  day_of_week     TINYINT       NOT NULL,        -- 0=Sun … 6=Sat
  typical_start   TIME          NULL,            -- median shift start time
  typical_end     TIME          NULL,            -- median shift end time
  typical_path    JSON          NULL,            -- [{lat,lng,...}] sampled polyline
  sample_count    INT           NOT NULL DEFAULT 0,
  computed_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rb_vehicle_session_dow (vehicle_id, session, day_of_week),
  -- FK policy: RESTRICT — consistent with the rest of the schema.
  CONSTRAINT fk_rb_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- route_deviations — append-only log of off-route / late events.
CREATE TABLE IF NOT EXISTS route_deviations (
  id              BIGINT        AUTO_INCREMENT PRIMARY KEY,
  vehicle_id      VARCHAR(20)   NOT NULL,
  driver_id       INT           NULL,
  session         ENUM('morning','evening') NOT NULL,
  deviation_type  ENUM('OFF_ROUTE','LATE','STALLED') NOT NULL,
  severity        ENUM('INFO','WARN','CRITICAL') NOT NULL DEFAULT 'WARN',
  expected_lat    DECIMAL(10,8) NULL,
  expected_lng    DECIMAL(11,8) NULL,
  actual_lat      DECIMAL(10,8) NOT NULL,
  actual_lng      DECIMAL(11,8) NOT NULL,
  offset_meters   INT           NULL,            -- distance from expected path
  delay_minutes   INT           NULL,            -- minutes behind typical timing
  occurred_at     TIMESTAMP(3)  NOT NULL,
  received_at     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at     TIMESTAMP     NULL,            -- set when vehicle returns to route
  notified_roles  VARCHAR(120)  NULL,            -- roles that received an alert
  -- FK policy: RESTRICT — consistent with the rest of the schema.
  CONSTRAINT fk_rd_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_rd_driver  FOREIGN KEY (driver_id)  REFERENCES drivers(id),
  INDEX idx_rd_vehicle_time (vehicle_id, occurred_at DESC),
  INDEX idx_rd_unresolved (resolved_at, occurred_at DESC),
  INDEX idx_rd_severity (severity, occurred_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. eta_predictions — cached ETA per pickup point
-- ────────────────────────────────────────────────────────────────────────────
-- One row per (vehicle_id, pickup_point_id, session, eta_date). Updated
-- whenever a new GPS ping arrives (cheap UPSERT) so reads are O(1).
-- The ETA is computed by the eta.service from the vehicle's recent speed +
-- remaining distance to the pickup point along its baseline path.
CREATE TABLE IF NOT EXISTS eta_predictions (
  id                  INT       AUTO_INCREMENT PRIMARY KEY,
  vehicle_id          VARCHAR(20) NOT NULL,
  pickup_point_id     INT       NOT NULL,
  session             ENUM('morning','evening') NOT NULL,
  eta_date            DATE      NOT NULL,
  eta_seconds         INT       NULL,            -- predicted seconds from now
  eta_at              TIMESTAMP NULL,            -- predicted arrival timestamp
  distance_meters     INT       NULL,
  confidence          ENUM('HIGH','MEDIUM','LOW','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  computed_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_eta_vehicle_point_session_date
    (vehicle_id, pickup_point_id, session, eta_date),
  -- FK policy: RESTRICT — consistent with the rest of the schema.
  CONSTRAINT fk_eta_vehicle  FOREIGN KEY (vehicle_id)      REFERENCES vehicles(id),
  CONSTRAINT fk_eta_point    FOREIGN KEY (pickup_point_id)  REFERENCES pickup_points(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. audit_logs action enum — add GEOFENCE + DEVIATION + ETA event types
-- New values are appended at the END of the enum list (INSTANT-compatible).
-- ALGORITHM=INSTANT makes the migration fail-fast if MySQL cannot apply it
-- without a table rewrite (audit_logs is the heaviest-write table in prod).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs
  MODIFY COLUMN action
  ENUM('CREATE','UPDATE','DELETE','EXPORT','LOGIN','IMPORT','APPROVE','VIEW',
       'GEOFENCE_ENTER','GEOFENCE_EXIT','ROUTE_DEVIATION','ETA_REFRESH')
  NOT NULL,
  ALGORITHM=INSTANT;
