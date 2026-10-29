import express from 'express';
import session from 'express-session';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';

import { workos } from '@/utils/workosClient';
import { authenticateWorkosSession } from '@/utils/workosSession';

vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  WORKOS: {
    apiKey: 'fixture-api-key',
    clientId: 'client_app',
    sessionIssuer: 'https://api.workos.com/user_management/client_app',
  },
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
}));

// Persistence is mocked here; the Mongo integration suite tests atomicity.
vi.mock('@/utils/workosSessionStore', () => ({
  replaceStoredWorkosSession: async (
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
}));

describe('Native WorkOS SDK session verification and rotation', () => {
  let key: CryptoKey;
  let accessToken: string;
  let refreshedToken: string;
  let jwk: object;
  let refreshStatus = 200;
  const requests: Array<Record<string, unknown>> = [];
  const profile = {
    object: 'user',
    id: 'user_example',
    email: 'member@example.com',
    email_verified: true,
    name: null,
    first_name: null,
    last_name: null,
    locale: null,
    profile_picture_url: null,
    last_sign_in_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    metadata: {},
  };
  const sign = (expires: number, extra: Record<string, unknown> = {}) =>
    new SignJWT({
      sub: 'user_example',
      sid: 'session_example',
      client_id: 'client_app',
      auth_time: Math.floor(Date.now() / 1000),
      ...extra,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'sdk-fixture' })
      .setIssuer('https://api.workos.com/user_management/client_app')
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(key);
  const app = express();
  app.use(
    session({
      secret: 'fixture-shared-secret-at-least-32-characters',
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.post('/sign-in', async (req, res, next) => {
    try {
      if (!workos) throw new Error('Missing fixture client');
      const response = await workos.userManagement.authenticateWithCode({
        code: 'fixture-code',
        codeVerifier: 'fixture-verifier',
        session: {
          sealSession: true,
          cookiePassword: 'fixture-shared-secret-at-least-32-characters',
        },
      });
      req.session.workosSession = response.sealedSession;
      res.sendStatus(200);
    } catch (error) {
      next(error);
    }
  });
  app.get('/protected', async (req, res) => {
    try {
      res.json(await authenticateWorkosSession(req));
    } catch (error) {
      res.sendStatus(
        error && typeof error === 'object' && 'status' in error
          ? Number(error.status)
          : 500,
      );
    }
  });

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    key = pair.privateKey;
    jwk = await exportJWK(pair.publicKey);
    vi.mocked(global.fetch).mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.includes('/sso/jwks/'))
        return new Response(
          JSON.stringify({
            keys: [{ ...jwk, alg: 'RS256', kid: 'sdk-fixture' }],
          }),
        );
      if (url.endsWith('/user_management/authenticate')) {
        const body = JSON.parse(String(options?.body));
        requests.push(body);
        const refreshing = body.grant_type === 'refresh_token';
        if (refreshing && refreshStatus !== 200)
          return new Response(
            JSON.stringify({ message: 'Temporary fixture failure' }),
            {
              status: refreshStatus,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        return new Response(
          JSON.stringify({
            user: profile,
            access_token: refreshing ? refreshedToken : accessToken,
            refresh_token: refreshing
              ? 'rotated-refresh-fixture'
              : 'original-refresh-fixture',
            authentication_method: 'GoogleOAuth',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error('Unexpected fixture request');
    });
  });
  beforeEach(async () => {
    requests.length = 0;
    refreshStatus = 200;
    accessToken = await sign(Math.floor(Date.now() / 1000) + 300);
    refreshedToken = accessToken;
  });

  it('exchanges the PKCE code and verifies the encrypted session using the real SDK and RSA JWKS', async () => {
    const agent = request.agent(app);
    await agent.post('/sign-in').timeout(2000).expect(200);
    const result = await agent.get('/protected').expect(200);
    expect(result.body).toEqual({
      userId: 'user_example',
      sessionId: 'session_example',
    });
    expect(requests[0]).toMatchObject({
      client_id: 'client_app',
      code: 'fixture-code',
      code_verifier: 'fixture-verifier',
    });
  });

  it('refreshes an expired session and saves the rotated refresh token', async () => {
    accessToken = await sign(1);
    const agent = request.agent(app);
    await agent.post('/sign-in').timeout(2000).expect(200);
    await agent.get('/protected').expect(200);
    expect(requests[1]).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'client_app',
      refresh_token: 'original-refresh-fixture',
    });
    expect(requests).toHaveLength(2);
    await agent.get('/protected').expect(200);
    expect(requests).toHaveLength(2);
  });

  it('rejects another application even when its token shares the environment signing key', async () => {
    accessToken = await sign(Math.floor(Date.now() / 1000) + 300, {
      client_id: 'client_other',
    });
    const agent = request.agent(app);
    await agent.post('/sign-in').timeout(2000).expect(200);
    await agent.get('/protected').expect(401);
    expect(requests).toHaveLength(1);
  });

  it('rejects a signed session token without the SDK-required auth_time claim', async () => {
    const token = await sign(Math.floor(Date.now() / 1000) + 300, {
      auth_time: undefined,
    });
    expect(await workos?.userManagement.verifyAccessToken(token)).toBeNull();
  });
});
