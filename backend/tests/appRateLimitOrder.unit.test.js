'use strict';

const app = require('../src/app');

function layerText(layer) {
  return String(layer.regexp || '');
}

function indexOfRouter(prefix) {
  return app._router.stack.findIndex((layer) => (
    layer.name === 'router' && layerText(layer).includes(prefix.replace(/\//g, '\\/'))
  ));
}

function globalLimiterIndex() {
  return app._router.stack.findIndex((layer) => (
    layer.name !== 'router' &&
    layerText(layer).includes('\\/api\\/driver') &&
    layerText(layer).includes('\\/api\\/school') &&
    layerText(layer).includes('\\/api\\/admin')
  ));
}

describe('global authenticated API rate limiter wiring', () => {
  test('covers the protected operator prefixes and excludes specialized routes', () => {
    expect(app.GLOBAL_API_LIMITED_PREFIXES).toEqual([
      '/api/driver',
      '/api/school',
      '/api/affiliation',
      '/api/province',
      '/api/transport',
      '/api/verification',
      '/api/documents',
      '/api/admin',
      '/api/readiness',
      '/api/terms',
      '/api/eta',
      '/api/geofences',
      '/api/route-deviations',
    ]);

    expect(app.GLOBAL_API_LIMITED_PREFIXES).not.toEqual(expect.arrayContaining([
      '/api/auth',
      '/api/line',
      '/api/parent',
      '/api/reports',
      '/api/visits',
    ]));
  });

  test('is mounted before every protected router it is meant to guard', () => {
    const limiter = globalLimiterIndex();
    expect(limiter).toBeGreaterThan(-1);

    for (const prefix of app.GLOBAL_API_LIMITED_PREFIXES) {
      const router = indexOfRouter(prefix);
      if (router === -1) continue; // feature-flagged router may be dark in test.
      expect(limiter).toBeLessThan(router);
    }
  });

  test('gives the public visit counter its own limiter, not the operator floor', () => {
    // `/api/visits/track` is unauthenticated, so it must not share a bucket
    // with authenticated operator traffic from the same NAT'd school — but it
    // must not be unlimited either, which is what it was before.
    expect(app.GLOBAL_API_LIMITED_PREFIXES).not.toContain('/api/visits');

    const limiter = globalLimiterIndex();
    const visitsLimiter = app._router.stack.findIndex((layer) => (
      layer.name !== 'router' &&
      layerText(layer).includes('\\/api\\/visits') &&
      !layerText(layer).includes('\\/api\\/driver')
    ));
    const visitsRouter = indexOfRouter('/api/visits');

    expect(visitsLimiter).toBeGreaterThan(-1);
    expect(visitsLimiter).toBeGreaterThan(limiter);
    expect(visitsRouter).toBeGreaterThan(visitsLimiter);
  });

  test('does not replace the dedicated reports limiter', () => {
    const limiter = globalLimiterIndex();
    const reportsLimiter = app._router.stack.findIndex((layer) => (
      layer.name !== 'router' &&
      layerText(layer).includes('\\/api\\/reports') &&
      !layerText(layer).includes('\\/api\\/driver')
    ));
    const reportsRouter = indexOfRouter('/api/reports');

    expect(reportsLimiter).toBeGreaterThan(limiter);
    expect(reportsRouter).toBeGreaterThan(reportsLimiter);
  });
});
