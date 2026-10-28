import express from 'express';
import session from 'express-session';
import request from 'supertest';

import { authenticateWorkosSession } from '@/utils/workosSession';

const fixture = vi.hoisted(() => ({
  authenticate: vi.fn(),
  refresh: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  WORKOS: { clientId: 'client_app' },
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
}));
vi.mock('@/utils/workosClient', () => ({
  workos: {
    userManagement: {
      loadSealedSession: () => ({
        authenticate: fixture.authenticate,
        refresh: fixture.refresh,
      }),
      verifyAccessToken: fixture.verify,
    },
  },
}));

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
    vi.resetAllMocks();
    store.clear();
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
    expect(refreshed.body.sealed).toBe('rotated-sealed-session');
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
});
