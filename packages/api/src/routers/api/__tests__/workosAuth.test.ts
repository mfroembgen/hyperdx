import express from 'express';
import session from 'express-session';
import request from 'supertest';

import workosAuthRouter, {
  logoutWorkos,
  safeReturnTo,
} from '@/routers/api/workosAuth';
import { generateSessionId } from '@/utils/workosSessionStore';

const fixture = {
  authorize: jest.fn(),
  exchange: jest.fn(),
  authenticate: jest.fn(),
  resolve: jest.fn(),
  logout: jest.fn(),
  load: jest.fn(),
};
jest.mock('@/config', () => ({
  ...jest.requireActual<typeof import('@/config')>('@/config'),
  WORKOS: {
    frontendOrigin: 'https://app.example.com',
    redirectUri: 'https://app.example.com/api/auth/workos/callback',
    issuer: 'https://identity.example.com',
    resource: 'https://app.example.com/api/mcp',
  },
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
}));
jest.mock('@/utils/workosClient', () => ({
  workos: {
    userManagement: {
      get getAuthorizationUrlWithPKCE() {
        return fixture.authorize;
      },
      get authenticateWithCode() {
        return fixture.exchange;
      },
      get getLogoutUrl() {
        return fixture.logout;
      },
      get loadSealedSession() {
        return fixture.load;
      },
    },
  },
}));
jest.mock('@/utils/workosIdentity', () => ({
  ...jest.requireActual<typeof import('@/utils/workosIdentity')>(
    '@/utils/workosIdentity',
  ),
  get resolveWorkosUser() {
    return fixture.resolve;
  },
}));
jest.mock('@/utils/workosSession', () => ({
  ...jest.requireActual<typeof import('@/utils/workosSession')>(
    '@/utils/workosSession',
  ),
  get authenticateSealedWorkosSession() {
    return fixture.authenticate;
  },
}));

// Sequential MemoryStore behavior only; Mongo tests prove atomicity.
jest.mock('@/utils/workosSessionStore', () => {
  const actual = jest.requireActual<
    typeof import('@/utils/workosSessionStore')
  >('@/utils/workosSessionStore');
  const save = (req: express.Request) =>
    new Promise<void>((resolve, reject) =>
      req.session.save(error => (error ? reject(error) : resolve())),
    );
  return {
    ...actual,
    storeWorkosLogin: async (
      req: express.Request,
      login: NonNullable<session.SessionData['workosLogin']>,
    ) => {
      req.session.workosLogin = login;
      await save(req);
      return true;
    },
    consumeWorkosLogin: async (req: express.Request, state: string) => {
      const login = req.session.workosLogin;
      if (!login || login.state !== state || login.expiresAt <= Date.now())
        return undefined;
      delete req.session.workosLogin;
      await save(req);
      return login;
    },
    claimWorkosSession: (req: express.Request) =>
      new Promise<boolean>((resolve, reject) =>
        req.sessionStore.destroy(req.sessionID, error =>
          error ? reject(error) : resolve(true),
        ),
      ),
  };
});

describe('WorkOS browser login and logout', () => {
  const app = express();
  app.use(
    session({
      secret: 'fixture-shared-secret-at-least-32-characters',
      genid: generateSessionId,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(workosAuthRouter);
  app.post('/logout', logoutWorkos);
  app.post('/seed-old-login', (req, res) => {
    req.session.workosSession = 'existing-valid-login';
    res.sendStatus(200);
  });
  app.get('/session-seal', (req, res) =>
    res.json({ seal: req.session.workosSession }),
  );
  beforeEach(() => {
    jest.resetAllMocks();
    fixture.authorize.mockResolvedValue({
      url: 'https://identity.example.com/authorize',
      state: 'fixture-state',
      codeVerifier: 'fixture-pkce-verifier',
    });
    fixture.exchange.mockResolvedValue({
      sealedSession: 'fixture-sealed-session',
    });
    fixture.authenticate.mockResolvedValue({
      userId: 'user_example',
      sessionId: 'session_example',
    });
    fixture.resolve.mockResolvedValue({
      _id: 'local-user',
      team: 'local-team',
      email: 'member@example.com',
    });
    fixture.logout.mockReturnValue(
      'https://api.workos.com/user_management/sessions/logout?session_id=session_example',
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('publishes protected-resource discovery without requiring login', async () => {
    const result = await request(app)
      .get('/.well-known/oauth-protected-resource/mcp')
      .expect(200);
    expect(result.body).toMatchObject({
      resource: 'https://app.example.com/api/mcp',
      authorization_servers: ['https://identity.example.com'],
      bearer_methods_supported: ['header'],
    });
    expect(result.headers['set-cookie']).toBeUndefined();
  });

  it('binds state and PKCE to the session, consumes them and changes the session ID', async () => {
    const agent = request.agent(app);
    const start = await agent
      .get('/auth/workos?returnTo=%2Fsearch%3Fq%3Dservice')
      .expect(302);
    expect(fixture.authorize).toHaveBeenCalledWith({
      provider: 'GoogleOAuth',
      redirectUri: 'https://app.example.com/api/auth/workos/callback',
    });
    const originalCookie = start.headers['set-cookie'][0].split(';')[0];
    const callback = await agent
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(303);
    expect(callback.headers.location).toBe(
      'https://app.example.com/search?q=service',
    );
    expect(callback.headers['set-cookie'][0].split(';')[0]).not.toBe(
      originalCookie,
    );
    expect(fixture.authenticate).toHaveBeenCalledWith('fixture-sealed-session');
    expect(fixture.exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'fixture-code',
        codeVerifier: 'fixture-pkce-verifier',
      }),
    );
    await agent
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(400);
    await request(app)
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .set('Cookie', originalCookie)
      .expect(400);
    expect(fixture.exchange).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid new code-exchange seal even with an existing login', async () => {
    const { authenticateSealedWorkosSession } = await jest.requireActual<
      typeof import('@/utils/workosSession')
    >('@/utils/workosSession');
    fixture.authenticate.mockImplementation(authenticateSealedWorkosSession);
    fixture.exchange.mockResolvedValue({ sealedSession: 'invalid-new-login' });
    fixture.load.mockReturnValue({
      authenticate: async () => ({
        authenticated: false,
        reason: 'invalid_jwt',
      }),
    });
    const agent = request.agent(app);
    await agent.post('/seed-old-login').expect(200);
    await agent.get('/auth/workos').expect(302);
    const denied = await agent
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(303);
    expect(denied.headers.location).toBe(
      'https://app.example.com/login?err=workosDenied',
    );
    expect(fixture.load).toHaveBeenCalledTimes(1);
    expect(fixture.load).toHaveBeenCalledWith(
      expect.objectContaining({ sessionData: 'invalid-new-login' }),
    );
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect((await agent.get('/session-seal').expect(200)).body.seal).toBe(
      'existing-valid-login',
    );
  });

  it('rejects mismatched, expired and unbound state before the code exchange', async () => {
    const agent = request.agent(app);
    await agent.get('/auth/workos').expect(302);
    await agent
      .get('/auth/workos/callback?state=attacker-state&code=fixture-code')
      .expect(400);
    await request(app)
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(400);
    const clock = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(clock + 11 * 60 * 1000);
    await agent
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(400);
    expect(fixture.exchange).not.toHaveBeenCalled();
  });

  it.each([
    'https://attacker.example.com/',
    '//attacker.example.com',
    '/\\attacker.example.com',
    '/path\nsecret',
  ])('rejects open return redirects %s', value => {
    expect(safeReturnTo(value)).toBe('/search');
  });

  it('requires same-origin POST logout and removes the server session before the provider redirect', async () => {
    const agent = request.agent(app);
    await agent.get('/auth/workos').expect(302);
    await agent
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(303);
    await agent
      .post('/logout')
      .set('Origin', 'https://attacker.example.com')
      .expect(403);
    const result = await agent
      .post('/logout')
      .set('Origin', 'https://app.example.com')
      .expect(303);
    expect(result.headers.location).toContain('session_id=session_example');
    expect(fixture.logout).toHaveBeenCalledWith({
      sessionId: 'session_example',
      returnTo: 'https://app.example.com/login',
    });
    expect(String(result.headers['set-cookie'])).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    await agent
      .get('/auth/workos/callback?state=fixture-state&code=fixture-code')
      .expect(400);
  });
});
