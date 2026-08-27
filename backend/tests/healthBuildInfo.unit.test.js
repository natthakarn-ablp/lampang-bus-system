'use strict';

function loadHealth({ gitResult, gitError, envCommit } = {}) {
  jest.resetModules();
  jest.doMock('../src/config/database', () => ({
    pool: { query: jest.fn() },
  }));
  jest.doMock('../src/config/env', () => ({
    app: { nodeEnv: 'test' },
  }));

  const execSync = jest.fn();
  if (gitError) execSync.mockImplementation(() => { throw gitError; });
  else execSync.mockReturnValue(Buffer.from(gitResult || 'abc1234\n'));
  jest.doMock('child_process', () => ({ execSync }));

  const previous = process.env.GIT_COMMIT;
  if (envCommit === undefined) delete process.env.GIT_COMMIT;
  else process.env.GIT_COMMIT = envCommit;

  const health = require('../src/utils/health');

  if (previous === undefined) delete process.env.GIT_COMMIT;
  else process.env.GIT_COMMIT = previous;

  return { health, execSync };
}

describe('health build info commit resolution', () => {
  afterEach(() => {
    jest.dontMock('../src/config/database');
    jest.dontMock('../src/config/env');
    jest.dontMock('child_process');
    jest.resetModules();
  });

  test('prefers git HEAD over a stale GIT_COMMIT env value', () => {
    const { health, execSync } = loadHealth({
      gitResult: '097b0ea\n',
      envCommit: '265f961-stale',
    });

    expect(health.getBuildInfo().commit).toBe('097b0ea');
    expect(execSync).toHaveBeenCalledWith('git rev-parse --short HEAD', expect.objectContaining({
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }));
  });

  test('falls back to GIT_COMMIT when git metadata is unavailable', () => {
    const { health } = loadHealth({
      gitError: new Error('not a git repo'),
      envCommit: '1234567890abcdef',
    });

    expect(health.getBuildInfo().commit).toBe('1234567890ab');
  });

  test('returns null when neither git nor GIT_COMMIT is available', () => {
    const { health } = loadHealth({
      gitError: new Error('not a git repo'),
    });

    expect(health.getBuildInfo().commit).toBeNull();
  });
});
