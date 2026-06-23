import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const checks = [
  {
    file: 'src/components/ui/AlertBanner.jsx',
    name: 'AlertBanner must not use side-stripe borders',
    pass: content => !/border-l-[2-9]/.test(content) && !/border-l-/.test(content),
  },
  {
    file: 'src/components/ui/CommandHero.jsx',
    name: 'CommandHero component exists with reduced-motion support',
    pass: content => /export default function CommandHero/.test(content) && /motion-reduce:/.test(content),
  },
  {
    file: 'src/components/ui/StatusStepRail.jsx',
    name: 'StatusStepRail component exists and renders steps accessibly',
    pass: content => /export default function StatusStepRail/.test(content) && /aria-label/.test(content),
  },
  {
    file: 'src/pages/school/VehicleVerification.jsx',
    name: 'school verification page uses command hero and status rail',
    pass: content => /CommandHero/.test(content) && /StatusStepRail/.test(content) && /VehiclePrivacyNotice/.test(content),
  },
  {
    file: 'src/pages/transport/VerificationQueue.jsx',
    name: 'transport queue page uses command hero and status rail',
    pass: content => /CommandHero/.test(content) && /StatusStepRail/.test(content) && /InspectionChecklistPanel/.test(content),
  },
  {
    file: 'src/pages/driver/DriverShift.jsx',
    name: 'driver shift page uses command hero and driver-safe action labels',
    pass: content => /CommandHero/.test(content) && /DriverVehicleCard/.test(content) && /เริ่มรอบด้วยรถคันนี้/.test(content),
  },
];

const failures = [];

for (const check of checks) {
  const fullPath = path.join(root, check.file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${check.file}: missing file for "${check.name}"`);
    continue;
  }
  const content = read(check.file);
  if (!check.pass(content)) {
    failures.push(`${check.file}: ${check.name}`);
  }
}

if (failures.length > 0) {
  console.error('Hybrid Motion UI guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Hybrid Motion UI guard passed');
