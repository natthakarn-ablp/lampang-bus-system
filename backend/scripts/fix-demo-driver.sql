-- Assign driver_id=1 to a vehicle for demo_drv testing
INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, term_id, start_date, is_active)
SELECT 1, v.id, '2568-2', CURDATE(), TRUE
FROM vehicles v
WHERE v.is_deleted = FALSE
AND NOT EXISTS (
  SELECT 1 FROM driver_vehicle_assignments dva
  WHERE dva.driver_id = 1 AND dva.vehicle_id = v.id
)
LIMIT 1;
SELECT dva.driver_id, dva.vehicle_id, dva.is_active FROM driver_vehicle_assignments dva WHERE dva.driver_id = 1;
