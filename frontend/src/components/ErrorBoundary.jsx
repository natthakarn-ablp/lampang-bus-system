import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import ReleaseVersion from './ReleaseVersion';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, kind: 'unknown' };
  }

  static getDerivedStateFromError(error) {
    const asset = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .+ failed|ChunkLoadError/i.test(String(error?.message || error?.name || ''));
    return { hasError: true, kind: asset ? 'asset' : 'unknown' };
  }

  componentDidCatch() {
    // Never log raw URLs, tokens, form data or component props.
    console.error('[ErrorBoundary]', this.state.kind === 'asset' ? 'UI-ASSET-LOAD' : 'UI-UNEXPECTED');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-warn-ink" strokeWidth={1.6} />
            <h1 className="text-xl font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h1>
            <p className="text-gray-600 mb-6">{this.state.kind === 'asset' ? 'โหลดไฟล์หน้าเว็บไม่สำเร็จ อาจเกิดจากการเชื่อมต่อหรือหน้าเว็บรุ่นก่อนหน้า กรุณาลองโหลดใหม่เมื่อพร้อม' : 'ระบบพบปัญหาที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง'}</p>
            <p className="text-sm text-ink-muted mb-3">ข้อมูลที่ยังไม่ได้บันทึกอาจสูญหายเมื่อรีเฟรชหรือเปลี่ยนหน้า ระบบยังไม่ได้โหลดใหม่ให้อัตโนมัติ</p>
            <p className="text-sm font-semibold text-ink mb-2">รหัสปัญหา: {this.state.kind === 'asset' ? 'UI-ASSET-LOAD' : 'UI-UNEXPECTED'}</p>
            <ReleaseVersion className="text-ink-muted mb-3" />
            <div className="flex flex-wrap gap-3 justify-center">
              <button onClick={() => window.location.reload()}
                className="focus-ring min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl transition">
                รีเฟรชหน้า
              </button>
              <button onClick={() => { window.location.href = '/'; }}
                className="focus-ring min-h-[48px] bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium px-6 py-3 rounded-xl transition">
                กลับหน้าหลัก
              </button>
            </div>
            <a href="/help" className="focus-ring inline-flex min-h-[44px] items-center mt-3 px-3 text-brand-700 underline">วิธีแจ้งปัญหา</a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
