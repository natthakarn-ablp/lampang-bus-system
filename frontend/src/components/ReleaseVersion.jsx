export default function ReleaseVersion({ className = '' }) {
  return <p className={`text-xs ${className}`} aria-label="เวอร์ชันเว็บไซต์">
    รุ่น {__RELEASE_VERSION__} · {__RELEASE_DATE__} · <span title="รหัสซอร์สที่ใช้สร้างหน้าเว็บ">{__SOURCE_COMMIT__}</span>
  </p>;
}
