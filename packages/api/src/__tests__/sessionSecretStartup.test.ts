import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { vi } from 'vitest';

vi.mock('@/api-app', () => ({ __esModule: true, default: vi.fn() }));
vi.mock('@/controllers/team', () => ({
  LOCAL_APP_TEAM: { _id: { toString: () => 'local-team' } },
}));
vi.mock('@/migrations', () => ({ runStartupMigrations: vi.fn() }));
vi.mock('@/models', () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
  connectDBWithRetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/opamp/app', () => ({ __esModule: true, default: vi.fn() }));
vi.mock('@/setupDefaults', () => ({ setupTeamDefaults: vi.fn() }));
vi.mock('@/utils/tokenEncryption', () => ({
  verifyTokenEncryption: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/utils/instrumentation', () => ({
  getCounter: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock('http-graceful-shutdown', () => ({ default: vi.fn() }));
vi.mock('http', async () => {
  const actual = await vi.importActual<typeof import('http')>('http');
  const createServer = vi.fn(() => ({ listen: vi.fn() }));
  return {
    ...actual,
    createServer,
    default: { ...actual, createServer },
  };
});

describe.each(['server', 'serverless'])(
  'session secret startup diagnostics (%s first)',
  first => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.resetModules();
    });

    it.each([
      [false, undefined, 1],
      [false, '', 1],
      [false, 'hyperdx is cool 👋', 1],
      [false, 'startup-secret-sentinel', 0],
      [true, undefined, 0],
      [true, 'hyperdx is cool 👋', 0],
      [true, 'startup-secret-sentinel', 0],
    ])(
      'local=%s, secret=%s logs %s times across both entrypoints',
      async (local, secret, count) => {
        process.env.APP_TYPE = 'api';
        if (local) {
          process.env.IS_LOCAL_APP_MODE = 'DANGEROUSLY_is_local_app_mode💀';
        } else {
          delete process.env.IS_LOCAL_APP_MODE;
        }
        if (typeof secret === 'undefined')
          delete process.env.EXPRESS_SESSION_SECRET;
        else process.env.EXPRESS_SESSION_SECRET = secret;

        const { default: logger } =
          await vi.importMock<typeof import('@/utils/logger')>(
            '@/utils/logger',
          );
        const { getCounter } = await vi.importMock<
          typeof import('@/utils/instrumentation')
        >('@/utils/instrumentation');
        const { default: Server } =
          await vi.importActual<typeof import('@/server')>('@/server');
        const { serverlessHandler } =
          await vi.importActual<typeof import('@/serverless')>('@/serverless');
        const config =
          await vi.importActual<typeof import('@/config')>('@/config');
        expect(logger.error).not.toHaveBeenCalled();

        const req = new IncomingMessage(new Socket());
        req.url = '/api/health';
        const res = new ServerResponse(req);
        if (first === 'server') await new Server().start();
        await serverlessHandler(req, res);
        await new Server().start();
        await serverlessHandler(req, res);

        expect(logger.error).toHaveBeenCalledTimes(count);
        const counter = vi.mocked(getCounter).mock.results[0].value;
        expect(counter.add).toHaveBeenCalledTimes(count);
        expect(
          JSON.stringify(vi.mocked(logger.error).mock.calls),
        ).not.toContain(config.EXPRESS_SESSION_SECRET);
      },
    );
  },
);
