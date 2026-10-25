'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('forced-password frontend recovery contract', () => {
  const app = read('frontend/src/App.jsx');
  const axios = read('frontend/src/api/axios.js');

  test('root rehydration sends a forced-password user to the change page', () => {
    const root = app.slice(app.indexOf('function RootRedirect()'), app.indexOf('export default function App()'));
    expect(root).toMatch(/must_change_password/);
    expect(root).toMatch(/Navigate to="\/change-password"/);
  });

  test('protected routes cannot render while a forced password change is pending', () => {
    const guard = app.slice(app.indexOf('function PrivateRoute('), app.indexOf('function RouteFallback()'));
    expect(guard).toMatch(/must_change_password/);
    expect(guard).toMatch(/Navigate to="\/change-password"/);
  });

  test('a server-side MUST_CHANGE_PASSWORD response redirects without clearing the session', () => {
    expect(axios).toMatch(/status\s*===\s*403/);
    expect(axios).toMatch(/MUST_CHANGE_PASSWORD/);
    expect(axios).toMatch(/window\.location\.href\s*=\s*['"]\/change-password['"]/);
  });
});
