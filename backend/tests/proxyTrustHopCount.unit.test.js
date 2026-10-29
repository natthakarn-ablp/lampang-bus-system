'use strict';

const express = require('express');
const request = require('supertest');
const productionApp = require('../src/app');

function createProxyIpProbe() {
  const app = express();
  // Keep this fixture tied to the production setting instead of duplicating
  // the hop count, so a change in app.js makes these expectations meaningful.
  app.set('trust proxy', productionApp.get('trust proxy'));
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip, peer: req.socket.remoteAddress });
  });
  return app;
}

describe('Express trust proxy hop-count behavior', () => {
  const app = createProxyIpProbe();

  test('uses the production app trust-proxy setting and identifies the direct peer without forwarding headers', async () => {
    expect(productionApp.get('trust proxy')).toBe(1);

    const response = await request(app).get('/ip').expect(200);
    expect(response.body.ip).toBe(response.body.peer);
  });

  test('a single X-Forwarded-For value is trusted when the socket peer occupies the one trusted hop', async () => {
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.77')
      .expect(200);

    // This is Express hop semantics for a synthetic one-hop peer. It does not
    // prove that an Internet client can reach or spoof the production proxy.
    expect(response.body.ip).toBe('198.51.100.77');
  });

  test('with two forwarded addresses, one trusted hop selects the rightmost XFF value', async () => {
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

  test('parses the rightmost IPv6 XFF address under the one-hop setting', async () => {
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '2001:db8::77, 2001:db8::24')
      .expect(200);

    expect(response.body.ip).toBe('2001:db8::24');
  });
});
