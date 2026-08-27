import { ChevronDown, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { ROLES, TAB_IDS, READINESS, SOURCE_TAGS } from '../../config/measurementFramework';

const TABS = Object.values(TAB_IDS);
const COLOR_MAP = {
  blue: 'border-blue-500', teal: 'border-teal-500', green: 'border-green-500',
  orange: 'border-orange-500', indigo: 'border-indigo-500', purple: 'border-purple-500',
};
const CODE_BG = {
  blue: 'bg-blue-600', teal: 'bg-teal-600', green: 'bg-green-600',
  orange: 'bg-orange-500', indigo: 'bg-indigo-600', purple: 'bg-purple-600',
};
const THRESHOLD_COLOR = { green: 'bg-green-50 text-green-700 border-green-200', amber: 'bg-amber-50 text-amber-700 border-amber-200', red: 'bg-red-50 text-red-700 border-red-200' };

export default function MeasurementFramework() {
  const [expanded, setExpanded] = useState(ROLES[0]?.id || '');

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-10">
      {/* Header */}
      <div className="bg-navy-700 text-white rounded-xl px-5 py-5 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-caption text-navy-200 uppercase tracking-wider">Measurement & Evaluation</p>
            <h1 className="text-lg font-semibold">คู่มือวัดผลระบบ — แยกตามสิทธิ์ผู้ใช้</h1>
            <p className="text-sm text-navy-200 mt-1">ตัวชี้วัด • เกณฑ์ • การปรับระบบ • ข้อพึงระวัง</p>
          </div>
          <span className="bg-white/15 text-white text-sm font-medium px-4 py-2 rounded-full shrink-0">
            {ROLES.length} สิทธิ์ • กดเปิดแต่ละบทบาท
          </span>
        </div>
      </div>

      {/* Intro */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-5 text-sm text-gray-600 space-y-1.5">
        <p><strong>Efficiency</strong> = ใช้ระบบได้เร็ว ถูกต้อง ครบ ภาระงานลดลง</p>
        <p><strong>Effectiveness</strong> = การใช้ระบบส่งผลต่อความปลอดภัยนักเรียนจริง</p>
        <p className="text-amber-700 font-medium">การ login ไม่ใช่ meaningful use — ต้องวัดจาก action จริง และต้องมี baseline เปรียบเทียบ</p>
      </div>

      {/* Role Accordions */}
      <div className="space-y-3">
        {ROLES.map(role => (
          <RoleAccordion key={role.id} role={role}
            isOpen={expanded === role.id}
            onToggle={() => setExpanded(expanded === role.id ? '' : role.id)} />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">คำอธิบายสัญลักษณ์</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">แหล่งข้อมูล (Source Tags)</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(SOURCE_TAGS).map(s => (
                <span key={s.label} className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`} title={s.full}>
                  {s.label} = {s.full}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">ความพร้อมในการวัด (Readiness)</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(READINESS).map(r => (
                <span key={r.label} className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.cls}`}>{r.label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Role Accordion ── */
function RoleAccordion({ role, isOpen, onToggle }) {
  const [activeTab, setActiveTab] = useState('metrics');

  return (
    <div className={`bg-white rounded-xl border-2 overflow-hidden transition-all ${isOpen ? 'border-gray-300 shadow-sm' : 'border-gray-200'}`}>
      {/* Header */}
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition">
        <div className={`w-1.5 h-10 rounded-full shrink-0 ${COLOR_MAP[role.color] || 'border-gray-400'} bg-current`}
          style={{ color: `var(--tw-border-opacity, 1)` }} />
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${CODE_BG[role.color]}`}>
          {role.code}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800">{role.name}</p>
          <p className="text-xs text-gray-500">{role.subtitle}</p>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-ink-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {/* Content */}
      {isOpen && (
        <div className="border-t border-gray-200 px-4 pb-4">
          {/* Tabs */}
          <div className="flex gap-1 py-3 overflow-x-auto">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'metrics' && (
            <div className="space-y-3">
              {role.metrics.map((m, i) => (
                <MetricCard key={i} metric={m} index={i + 1} />
              ))}
            </div>
          )}

          {activeTab === 'thresholds' && (
            <div className="space-y-2">
              {role.thresholds.map((t, i) => (
                <div key={i} className={`rounded-lg border px-4 py-2.5 ${THRESHOLD_COLOR[t.color] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                  <span className="font-semibold text-sm">{t.level}:</span>
                  <span className="text-sm ml-1.5">{t.criteria}</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'changes' && (
            <ul className="space-y-2">
              {role.changes.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-blue-500 mt-0.5">●</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}

          {activeTab === 'cautions' && (
            <ul className="space-y-2">
              {role.cautions.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.2} aria-hidden="true" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Metric Card ── */
function MetricCard({ metric, index }) {
  const r = READINESS[metric.readiness] || READINESS.partial;
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            <span className="text-gray-400 mr-1">{index}.</span>
            {metric.title}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{metric.desc}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${r.cls}`}>{r.label}</span>
      </div>
      {metric.why && (
        <p className="text-xs text-teal-700 bg-teal-50 rounded px-2 py-1 mt-1 mb-1">
          <strong>ทำไมถึงสำคัญ:</strong> {metric.why}
        </p>
      )}
      {metric.evidence && (
        <p className="text-xs text-indigo-700 bg-indigo-50 rounded px-2 py-1 mb-1">
          <strong>หลักฐานในระบบ:</strong> {metric.evidence}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="text-sm font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-lg">
          เป้าหมาย: {metric.target}
        </span>
        {metric.sources.map(s => {
          const tag = SOURCE_TAGS[s];
          return tag ? (
            <span key={s} className={`text-xs font-medium px-1.5 py-0.5 rounded ${tag.cls}`} title={tag.full}>{tag.label}</span>
          ) : null;
        })}
        {metric.forms?.length > 0 && metric.forms.map(f => (
          <span key={f} className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{f}</span>
        ))}
      </div>
    </div>
  );
}
