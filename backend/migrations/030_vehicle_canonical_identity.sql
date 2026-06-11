-- 030_vehicle_canonical_identity.sql — Phase 10.13B-3
-- Additive DB-level enforcement of (a) vehicle canonical identity (province-alias
-- aware) for ACTIVE vehicles, and (b) one active driver assignment per vehicle.
-- No business data is changed; no vehicle/student/driver row is merged or deleted.
-- Preflight (10.13B-3 Part A) confirmed 0 active canonical dup groups and 0
-- vehicles with >1 active assignment, so the UNIQUE indexes are safe to add.
--
-- vehicles.canonical_plate is code/script-maintained (computed via plateIdentity,
-- province-alias resolved; NULL for unparseable or province-less plates so we
-- never enforce uniqueness on an ambiguous plate). active_canonical_plate is a
-- STORED generated column = canonical_plate while is_deleted=0 (NULL once
-- soft-deleted, which frees the canonical for a future active vehicle).
ALTER TABLE vehicles
  ADD COLUMN canonical_plate VARCHAR(120) NULL AFTER normalized_plate,
  ADD COLUMN active_canonical_plate VARCHAR(120)
    GENERATED ALWAYS AS (CASE WHEN is_deleted = 0 THEN canonical_plate ELSE NULL END) STORED
    AFTER canonical_plate,
  ADD INDEX idx_vehicles_canonical (canonical_plate),
  ADD UNIQUE KEY uq_vehicles_active_canonical (active_canonical_plate);

-- One active assignment per vehicle. active_vehicle_id is generated from
-- is_active + vehicle_id (NULL when the assignment is ended), so ending an
-- assignment automatically frees the vehicle. Multiple NULLs are allowed.
ALTER TABLE driver_vehicle_assignments
  ADD COLUMN active_vehicle_id VARCHAR(20)
    GENERATED ALWAYS AS (CASE WHEN is_active = 1 THEN vehicle_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_dva_active_vehicle (active_vehicle_id);
