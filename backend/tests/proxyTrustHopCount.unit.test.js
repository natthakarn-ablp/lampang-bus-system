'use strict';

const express = require('express');
const request = require('supertest');
const productionApp = require('../src/app');

function createProxyIpProbe() {
  const app = express();
  // Keep this fixture tied to the production setting instead of duplicating
  // the trusted peer setting, so a change in app.js makes these expectations meaningful.
  app.set('trust proxy', productionApp.get('trust proxy'));
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip, peer: req.socket.remoteAddress });
  });
  return app;
}

describe('Express loopback proxy trust behavior', () => {
  const app = createProxyIpProbe();

  test('uses the production app trust-proxy setting and identifies the direct peer without forwarding headers', async () => {
    expect(productionApp.get('trust proxy')).toBe('loopback');

    const response = await request(app).get('/ip').expect(200);
    expect(response.body.ip).toBe(response.body.peer);
  });

  test('trusts loopback peers but not a directly connected public peer', () => {
    const trust = productionApp.get('trust proxy fn');
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('::1', 0)).toBe(true);
    expect(trust('::ffff:127.0.0.1', 0)).toBe(true);
    expect(trust('203.0.113.24', 0)).toBe(false);
    expect(trust('2001:db8::24', 0)).toBe(false);
  });

  test('accepts one nginx-overwritten XFF value from the loopback peer', async () => {
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.77')
      .expect(200);

    // This is Express hop semantics for a synthetic one-hop peer. It does not
    // prove that an Internet client can reach or spoof the production proxy.
    expect(response.body.ip).toBe('198.51.100.77');
  });

  test('with an unsanitized two-address chain, the first untrusted address is the edge', async () => {
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.77, 203.0.113.24')
      .set('CF-Connecting-IP', '198.51.100.88')
      .expect(200);

    expect(response.body.ip).toBe('203.0.113.24');
  });

  test.each([
    ['CF-Connecting-IP', '198.51.100.77'],
    ['X-Real-IP', '198.51.100.77'],
    ['Forwarded', 'for=198.51.100.77'],
  ])('does not use %s alone to calculate req.ip', async (header, value) => {
    const response = await request(app)
      .get('/ip')
      .set(header, value)
      .expect(200);

    expect(response.body.ip).toBe(response.body.peer);
  });

  test('selects the edge address from an unsanitized IPv6 chain', async () => {
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '2001:db8::77, 2001:db8::24')
      .expect(200);

    expect(response.body.ip).toBe('2001:db8::24');
  });
});
