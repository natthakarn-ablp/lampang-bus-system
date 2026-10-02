// Role accent colours. Used ONLY for this chip — never for status, which
// always comes from ./tone.js. White text on each passes 4.5:1.
export const ROLE_ACCENT = {
  school:      { bg: '#0F766E', label: 'โรงเรียน' },
  affiliation: { bg: '#4338CA', label: 'สังกัด' },
  province:    { bg: '#1D4ED8', label: 'จังหวัด' },
  transport:   { bg: '#C2410C', label: 'ขนส่ง' },
  admin:       { bg: '#7C3AED', label: 'ผู้ดูแลระบบ' },
};

export default function RoleChip({ role, label }) {
  const a = ROLE_ACCENT[role];
  if (!a) return null;
  return (
    <span
      className="inline-flex self-start items-center rounded-full px-3 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: a.bg }}
    >
      {label || a.label}
    </span>
  );
}
