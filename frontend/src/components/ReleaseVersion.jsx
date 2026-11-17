export default function ReleaseVersion({ className = '' }) {
  return <a href="/updates" className={`focus-ring inline-flex min-h-[44px] items-center text-xs underline underline-offset-2 ${className}`} aria-label="เวอร์ชันเว็บไซต์">
    รุ่น {__RELEASE_VERSION__} · {__RELEASE_DATE__} · <span title="รหัสซอร์สที่ใช้สร้างหน้าเว็บ">{__SOURCE_COMMIT__}</span>
  </a>;
}
