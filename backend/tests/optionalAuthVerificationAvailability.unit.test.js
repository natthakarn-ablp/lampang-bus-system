'use strict';

jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const idTokenSvc = require('../src/services/lineIdToken.service');
const { optionalAuth } = require('../src/middleware/optionalAuth');

function makeRequest(authorization = 'Bearer synthetic-token') {
  return { headers: { authorization }, query: {}, body: {} };
}

function makeResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

test.each(['timeout', 'network_error', 'upstream_unavailable', 'verification_busy'])(
  'optional authentication returns 503 for transient LINE verification result %s',
  async (error) => {
    idTokenSvc.verifyIdToken.mockResolvedValueOnce({ valid: false, error });
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await optionalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errors: [{ code: 'LINE_VERIFY_UNAVAILABLE' }],
    }));
    expect(req.lineUserId).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  }
);

test('ordinary invalid token stays anonymous without being treated as verified', async () => {
  idTokenSvc.verifyIdToken.mockResolvedValueOnce({ valid: false, error: 'invalid_token' });
  const req = makeRequest();
  const res = makeResponse();
  const next = jest.fn();

  await optionalAuth(req, res, next);

  expect(req.lineUserId).toBeUndefined();
  expect(res.status).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
});
