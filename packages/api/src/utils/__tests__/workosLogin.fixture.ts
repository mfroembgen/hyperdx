import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';

import * as config from '@/config';
import router, { logoutWorkos } from '@/routers/api/workosAuth';
import { authenticateWorkosSession } from '@/utils/workosSession';
import { generateSessionId } from '@/utils/workosSessionStore';

const mocks = {
  authorize: jest.fn(),
  exchange: jest.fn(),
};
export const fixture = mocks;
jest.mock('@/config', () => ({
  ...jest.requireActual<typeof import('@/config')>('@/config'),
  WORKOS: {
    clientId: 'client_app',
    frontendOrigin: 'https://app.example.com',
    redirectUri: 'https://app.example.com/api/auth/workos/callback',
  },
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
}));
jest.mock('@/utils/workosIdentity', () => ({
  ...jest.requireActual<typeof import('@/utils/workosIdentity')>(
    '@/utils/workosIdentity',
  ),
  resolveWorkosUser: async () => ({
    _id: 'local-user',
    team: 'local-team',
    email: 'member@example.com',
  }),
}));
jest.mock('@/utils/workosClient', () => ({
  workos: {
    userManagement: {
      get getAuthorizationUrlWithPKCE() {
        return mocks.authorize;
      },
      get authenticateWithCode() {
        return mocks.exchange;
      },
      getLogoutUrl: () => 'https://identity.example.com/logout',
      loadSealedSession: ({ sessionData }: { sessionData: string }) => {
        let seal = sessionData;
        return {
          authenticate: async () =>
            ['old-seal', 'invalid-new-login'].includes(seal)
              ? { authenticated: false, reason: 'invalid_jwt' }
              : {
                  authenticated: true,
                  user: { id: 'user_example' },
                  sessionId: 'session_example',
                  accessToken: seal,
                },
          refresh: async () => {
            seal = 'fresh-seal';
            return { authenticated: true, sealedSession: seal };
          },
        };
      },
      verifyAccessToken: async () => ({
        sub: 'user_example',
        sid: 'session_example',
        client_id: 'client_app',
        exp: 123,
        iat: 1,
      }),
    },
  },
}));

export const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => (release = resolve));
  return { promise, release };
};
export const authorization = {
  url: 'https://identity.example.com/authorize',
  state: 'fixture-state',
  codeVerifier: 'fixture-pkce-verifier',
};
export const callbackPath =
  '/auth/workos/callback?state=fixture-state&code=fixture-code';

export function loginReplica() {
  const store = new MongoStore({ mongoUrl: config.MONGO_URI });
  const app = express();
  app.use(
    session({
      secret: 'fixture-shared-secret-at-least-32-characters',
      genid: generateSessionId,
      store,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.post('/seed', (req, res) => {
    req.session.workosSession = 'old-seal';
    req.session.workosSessionId = 'session_example';
    req.session.workosLogin = {
      state: authorization.state,
      codeVerifier: authorization.codeVerifier,
      expiresAt: Date.now() + 60_000,
      returnTo: '/search',
    };
    res.json({ id: req.sessionID });
  });
  app.get('/protected', async (req, res) => {
    try {
      res.json(await authenticateWorkosSession(req));
    } catch {
      res.sendStatus(503);
    }
  });
  app.post('/logout', logoutWorkos);
  app.use(router);
  app.use(
    (
      _error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (!res.headersSent) res.sendStatus(500);
    },
  );
  return { app, store };
}
