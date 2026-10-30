import express from 'express';
import session from 'express-session';
import request from 'supertest';

import {
  authenticateSealedWorkosSession,
  authenticateWorkosSession,
} from '@/utils/workosSession';
import { replaceStoredWorkosSession } from '@/utils/workosSessionStore';

const fixture = {
  authenticate: jest.fn(),
  refresh: jest.fn(),
  verify: jest.fn(),
  load: jest.fn(),
};
jest.mock('@/config', () => ({
  ...jest.requireActual<typeof import('@/config')>('@/config'),
  WORKOS: { clientId: 'client_app' },
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
}));
jest.mock('@/utils/workosClient', () => ({
  workos: {
    userManagement: {
      get loadSealedSession() {
        return fixture.load;
      },
      get verifyAccessToken() {
        return fixture.verify;
      },
    },
  },
}));

// Persistence is mocked here; the Mongo integration suite tests atomicity.
jest.mock('@/utils/workosSessionStore', () => ({
  replaceStoredWorkosSession: jest.fn(
    async (
      req: express.Request,
      expected: string,
      replacement: string | undefined,
    ) => {
      const stored = await new Promise<session.SessionData | null | undefined>(
        (resolve, reject) =>
          req.sessionStore.get(req.sessionID, (error, value) =>
            error ? reject(error) : resolve(value),
          ),
      );
      if (!stored?.workosSession) return undefined;
      if (stored.workosSession !== expected) return stored.workosSession;
      if (replacement === undefined) delete stored.workosSession;
      else stored.workosSession = replacement;
      await new Promise<void>((resolve, reject) =>
        req.sessionStore.set(req.sessionID, stored, error =>
          error ? reject(error) : resolve(),
        ),
      );
      return replacement;
    },
  ),
}));

const persistSession = jest
  .mocked(replaceStoredWorkosSession)
  .getMockImplementation();
if (!persistSession) throw new Error('Session persistence mock is required');

describe('WorkOS sealed server session', () => {
  const store = new session.MemoryStore();
  const replica = () => {
    const app = express();
    app.use(
      session({
        secret: 'fixture-shared-secret-at-least-32-characters',
        store,
        resave: false,
        saveUninitialized: false,
      }),
    );
    app.post('/seed', (req, res) => {
      req.session.workosSession = 'old-sealed-session';
      res.sendStatus(200);
    });
    app.get('/protected', async (req, res) => {
      try {
        res.json({
          ...(await authenticateWorkosSession(req)),
          sealed: req.session.workosSession,
        });
      } catch (error) {
        res.sendStatus(
          error && typeof error === 'object' && 'status' in error
            ? Number(error.status)
            : 500,
        );
      }
    });
    return app;
  };
  const app = replica();
  const auth = {
    authenticated: true,
    user: { id: 'user_example' },
    sessionId: 'session_example',
    accessToken: 'fixture-access-token',
  };
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(replaceStoredWorkosSession).mockImplementation(persistSession);
    store.clear();
    fixture.load.mockReturnValue({
      get authenticate() {
        return fixture.authenticate;
      },
      get refresh() {
        return fixture.refresh;
      },
    });
    fixture.authenticate.mockResolvedValue(auth);
    fixture.verify.mockResolvedValue({
      sub: 'user_example',
      sid: 'session_example',
      client_id: 'client_app',
      exp: 123,
      iat: 1,
    });
  });

  it('saves a rotated SDK session before the next replica reads it', async () => {
    const agent = request.agent(app);
    const seed = await agent.post('/seed').expect(200);
    const cookie = seed.headers['set-cookie'][0].split(';')[0];
    fixture.authenticate.mockResolvedValueOnce({
      authenticated: false,
      reason: 'invalid_jwt',
    });
    fixture.refresh.mockResolvedValue({
      authenticated: true,
      sealedSession: 'rotated-sealed-session',
    });
    const refreshed = await agent.get('/protected').expect(200);
    expect(refreshed.body.sealed).toBe('old-sealed-session');
    const another = await request(replica())
      .get('/protected')
      .set('Cookie', cookie)
      .expect(200);
    expect(another.body.sealed).toBe('rotated-sealed-session');
  });

  it('retains refresh credentials after transient failures but clears a terminal session', async () => {
    const agent = request.agent(app);
    await agent.post('/seed').expect(200);
    fixture.authenticate.mockResolvedValueOnce({
      authenticated: false,
      reason: 'invalid_jwt',
    });
    fixture.refresh.mockResolvedValueOnce({
      authenticated: false,
      retryable: true,
      reason: 'server_error',
    });
    await agent.get('/protected').expect(503);
    const retry = await agent.get('/protected').expect(200);
    expect(retry.body.sealed).toBe('old-sealed-session');
    fixture.authenticate.mockResolvedValueOnce({
      authenticated: false,
      reason: 'invalid_jwt',
    });
    fixture.refresh.mockResolvedValueOnce({
      authenticated: false,
      retryable: false,
      reason: 'invalid_grant',
    });
    await agent.get('/protected').expect(401);
    await agent.get('/protected').expect(401);
  });

  it('rejects the wrong application and wrong subject even after SDK signature verification', async () => {
    const agent = request.agent(app);
    await agent.post('/seed').expect(200);
    fixture.verify.mockResolvedValueOnce({
      sub: 'user_example',
      sid: 'session_example',
      client_id: 'client_other',
      exp: 123,
      iat: 1,
    });
    await agent.get('/protected').expect(401);
    fixture.verify.mockResolvedValueOnce({
      sub: 'user_other',
      sid: 'session_example',
      client_id: 'client_app',
      exp: 123,
      iat: 1,
    });
    await agent.get('/protected').expect(401);
  });

  it.each([
    { client_id: 'client_other' },
    { sub: 'user_other' },
    { sid: 'session_other' },
    { sub_profile: 'service' },
    { sub_type: 'machine' },
  ])(
    'fully verifies a winning replica seal with claims %j',
    async overrides => {
      const agent = request.agent(app);
      await agent.post('/seed').expect(200);
      fixture.authenticate.mockResolvedValueOnce({
        authenticated: false,
        reason: 'invalid_jwt',
      });
      fixture.refresh.mockResolvedValueOnce({
        authenticated: false,
        retryable: false,
        reason: 'invalid_grant',
      });
      jest
        .mocked(replaceStoredWorkosSession)
        .mockResolvedValueOnce('winning-seal');
      fixture.verify.mockResolvedValueOnce({
        sub: 'user_example',
        sid: 'session_example',
        client_id: 'client_app',
        exp: 123,
        iat: 1,
        ...overrides,
      });
      await agent.get('/protected').expect(401);
      expect(fixture.verify).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds repeated canonical refresh conflicts', async () => {
    const agent = request.agent(app);
    await agent.post('/seed').expect(200);
    fixture.authenticate.mockResolvedValue({
      authenticated: false,
      reason: 'invalid_jwt',
    });
    fixture.refresh.mockResolvedValue({
      authenticated: false,
      retryable: false,
      reason: 'invalid_grant',
    });
    jest.mocked(replaceStoredWorkosSession).mockResolvedValue('another-seal');
    await agent.get('/protected').expect(503);
    expect(fixture.refresh).toHaveBeenCalledTimes(3);
    expect(replaceStoredWorkosSession).toHaveBeenCalledTimes(3);
  });

  it('validates provisional login seals without refresh or canonical fallback', async () => {
    fixture.authenticate.mockResolvedValue({
      authenticated: false,
      reason: 'invalid_jwt',
    });
    await expect(
      authenticateSealedWorkosSession('invalid-new-login'),
    ).rejects.toMatchObject({ status: 401 });
    expect(fixture.refresh).not.toHaveBeenCalled();
    expect(replaceStoredWorkosSession).not.toHaveBeenCalled();
  });
});
