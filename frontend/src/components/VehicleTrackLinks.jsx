import { Link } from 'react-router-dom';
import { Route as RouteIcon, MoonStar } from 'lucide-react';
import { AlertBanner } from './ui';

const TRACK_PATH = {
  school: '/school/vehicle-track',
  affiliation: '/affiliation/vehicle-track',
  province: '/province/vehicle-track',
  admin: '/admin/vehicle-track',
};

/**
 * Entry point from a live-vehicle page to ประวัติเส้นทางรถ.
 * With `vehicleId` it opens straight on that vehicle (compact row button);
 * without, it is the page-level action.
 */
export function VehicleTrackLink({ role, vehicleId = null, compact = false }) {
  const to = vehicleId
    ? `${TRACK_PATH[role]}?vehicle=${encodeURIComponent(vehicleId)}`
    : TRACK_PATH[role];
  if (compact) {
    return (
      <Link
        to={to}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="focus-ring mt-2 inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-3 rounded-lg border border-surface-border text-xs font-medium text-brand hover:bg-surface"
      >
        <RouteIcon className="w-3.5 h-3.5" strokeWidth={2.2} />
        ประวัติเส้นทาง
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className="focus-ring inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface"
    >
      <RouteIcon className="w-4 h-4" strokeWidth={2} />
      ประวัติเส้นทางรถ
    </Link>
  );
}

/**
 * Calm note shown on live-vehicle pages outside the GPS tracking windows,
 * so a board full of "ออฟไลน์" outside school-run hours reads as expected
 * rather than as an outage. `tracking` comes from the live-vehicles API.
 */
export function TrackingWindowNote({ tracking }) {
  if (!tracking || tracking.in_window_now !== false) return null;
  return (
    <AlertBanner variant="info" title="นอกช่วงเวลาติดตาม">
      <span className="inline-flex items-start gap-1.5">
        <MoonStar className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
        ระบบบันทึกตำแหน่งรถเฉพาะช่วง {tracking.label} น. ขณะนี้รถจึงแสดงเป็นออฟไลน์หรือหยุดส่งได้ตามปกติ
      </span>
    </AlertBanner>
  );
}
