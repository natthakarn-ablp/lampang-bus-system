/**
 * Shared vehicle safety display components for all roles.
 */
import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';

const INSPECTION_MAP = {
  PASSED:    { label: 'ผ่าน',     cls: 'bg-success-soft text-success-ink border-success/20', Icon: CheckCircle2 },
  FAILED:    { label: 'ไม่ผ่าน',  cls: 'bg-danger-soft text-danger-ink border-danger/20',    Icon: XCircle },
  NEEDS_FIX: { label: 'ต้องแก้ไข', cls: 'bg-warn-soft text-warn-ink border-warn/20',         Icon: AlertTriangle },
  PENDING:   { label: 'รอตรวจ',    cls: 'bg-surface text-ink-muted border-surface-border',  Icon: Clock },
};

function getInsuranceStatus(expiry) {
  if (!expiry) return { label: 'ไม่ระบุ', cls: 'text-gray-400', level: 'unknown' };
  const days = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: 'หมดแล้ว', cls: 'text-red-600 font-bold', level: 'expired' };
  if (days <= 30) return { label: `อีก ${days} วัน`, cls: 'text-amber-600 font-medium', level: 'expiring' };
  return { label: 'ปกติ', cls: 'text-green-600', level: 'ok' };
}

export function VehicleSafetySection({ vehicle }) {
  const insp = vehicle.latest_inspection_result;
  const inspInfo = INSPECTION_MAP[insp] || null;
  const insStatus = getInsuranceStatus(vehicle.insurance_expiry);

  const hasRisk = !insp || insp === 'FAILED' || insp === 'NEEDS_FIX' || insStatus.level === 'expired';

  return (
    <div className={`rounded-lg p-3 mt-2 ${hasRisk ? 'bg-red-50 border border-red-200' : 'bg-green-50/50 border border-green-100'}`}>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {/* Inspection */}
        <div>
          <span className="text-gray-500">ตรวจสภาพ: </span>
          {inspInfo ? (
            <span className={`inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full text-xs border ${inspInfo.cls}`}>
              <inspInfo.Icon className="w-3 h-3" strokeWidth={2.2} />
              {inspInfo.label}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full text-xs border bg-red-100 text-red-600 border-red-200">
              <AlertTriangle className="w-3 h-3" strokeWidth={2.2} />
              ยังไม่ตรวจ
            </span>
          )}
        </div>

        {/* Insurance */}
        <div>
          <span className="text-gray-500">ประกัน: </span>
          <span className={insStatus.cls}>{vehicle.insurance_status || '-'}</span>
          {vehicle.insurance_expiry && (
            <span className={`ml-1 text-xs ${insStatus.cls}`}>
              ({insStatus.label})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
