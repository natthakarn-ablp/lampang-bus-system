'use strict';

// DRV-UPLOADS-08: a file with an unsupported extension (e.g. HEIC) is dropped
// silently by multer's fileFilter, so the route replied "please choose a file".
// The filter must now flag the rejection so the route can say the type is wrong.

const captured = [];
jest.mock('multer', () => {
  const m = jest.fn((opts) => { captured.push(opts); return { single: () => (_q, _r, n) => n() }; });
  m.diskStorage = jest.fn(() => ({}));
  return m;
});

describe('upload fileFilter flags unsupported file types', () => {
  beforeAll(() => {
    require('../src/routes/driver.routes');
    require('../src/routes/registration.routes');
  });

  test('both upload configs flag a .heic file as a type rejection', () => {
    const filters = captured.map((o) => o.fileFilter).filter(Boolean);
    expect(filters.length).toBeGreaterThanOrEqual(2);
    for (const f of filters) {
      const req = {};
      const cb = jest.fn();
      f(req, { originalname: 'IMG_0001.HEIC' }, cb);
      expect(cb).toHaveBeenCalledWith(null, false);
      expect(req.fileTypeRejected).toBe(true);
    }
  });

  test('supported extension is accepted and not flagged', () => {
    for (const f of captured.map((o) => o.fileFilter).filter(Boolean)) {
      const req = {};
      const cb = jest.fn();
      f(req, { originalname: 'a.JPG' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
      expect(req.fileTypeRejected).toBeUndefined();
    }
  });
});
