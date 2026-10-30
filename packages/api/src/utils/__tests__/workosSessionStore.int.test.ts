import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

import * as config from '@/config';
import { authenticateWorkosSession } from '@/utils/workosSession';
import { replaceStoredWorkosSession } from '@/utils/workosSessionStore';

const fixture = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  WORKOS: { clientId: 'client_app' },
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
}));
vi.mock('@/utils/workosClient', () => ({
  workos: {
    userManagement: {
      loadSealedSession: ({ sessionData }: { sessionData: string }) => {
        let current = sessionData;
        return {
          authenticate: async () =>
            current === 'old-seal'
              ? { authenticated: false, reason: 'invalid_jwt' }
              : {
                  authenticated: true,
                  user: { id: 'user_example' },
                  sessionId: 'session_example',
                  accessToken: current,
                },
          refresh: async () => {
            const result = await fixture.refresh();
            if (result.authenticated) current = result.sealedSession;
            return result;
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

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => (release = resolve));
  return { promise, release };
};
const fresh = { authenticated: true, sealedSession: 'fresh-seal' };
const terminal = {
  authenticated: false,
  retryable: false,
  reason: 'invalid_grant',
};

describe('WorkOS refresh persistence across Mongo-backed replicas', () => {
  const stores: MongoStore[] = [];
  const replica = () => {
    const store = new MongoStore({ mongoUrl: config.MONGO_URI });
    stores.push(store);
    const app = express();
    app.use(
      session({
        secret: 'fixture-shared-secret-at-least-32-characters',
        store,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: { maxAge: 60_000 },
      }),
    );
    app.post('/seed', (req, res) => {
      req.session.workosSession = 'old-seal';
      req.session.workosSessionId = 'session_example';
      req.session.workosLogin = {
        state: 'untouched-state',
        codeVerifier: 'untouched-verifier',
        expiresAt: Date.now() + 60_000,
        returnTo: '/search',
      };
      res.json({ id: req.sessionID });
    });
    app.get('/protected', async (req, res) => {
      try {
        res.json({
          ...(await authenticateWorkosSession(req)),
          requestSeal: req.session.workosSession,
        });
      } catch (error) {
        res.sendStatus(
          error && typeof error === 'object' && 'status' in error
            ? Number(error.status)
            : 500,
        );
      }
    });
    app.post('/logout', (req, res, next) => {
      req.session.destroy(error => (error ? next(error) : res.sendStatus(200)));
    });
    // A completed in-flight response can only touch a session deleted by logout.
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
  };
  let first: ReturnType<typeof replica>;
  let second: ReturnType<typeof replica>;
  let cookie: string;
  let sid: string;
  const stored = async () =>
    (await first.store.collectionP).findOne({ _id: sid });
  beforeEach(async () => {
    fixture.refresh.mockReset().mockResolvedValue(fresh);
    first = replica();
    second = replica();
    const seeded = await request(first.app).post('/seed').expect(200);
    cookie = seeded.headers['set-cookie'][0].split(';')[0];
    sid = seeded.body.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await (await first.store.collectionP).deleteMany({});
    await Promise.all(stores.splice(0).map(store => store.close()));
  });

  it('keeps a winning rotation when a delayed replica gets terminal invalid_grant', async () => {
    const entered = gate();
    const resume = gate();
    fixture.refresh.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return terminal;
    });
    const delayed = request(second.app)
      .get('/protected')
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    const winner = await request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(200);
    const persisted = JSON.parse(String((await stored())?.session));
    expect(persisted.workosSession).toBe('fresh-seal');
    expect(persisted.workosLogin.state).toBe('untouched-state');
    resume.release();
    expect((await delayed).status).toBe(200);
    // Neither replica may dirty its stale Express session and trigger a full save.
    expect(winner.body.requestSeal).toBe('old-seal');
    await request(second.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.parse(String((await stored())?.session)).workosSession).toBe(
      'fresh-seal',
    );
    expect(fixture.refresh).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect logout when a successful refresh completes later', async () => {
    const entered = gate();
    const resume = gate();
    fixture.refresh.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return fresh;
    });
    const refreshing = request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app).post('/logout').set('Cookie', cookie).expect(200);
    expect(await stored()).toBeNull();
    resume.release();
    expect((await refreshing).status).toBe(401);
    expect(await stored()).toBeNull();
    await request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('clears only the unchanged terminal seal and preserves transient failures', async () => {
    fixture.refresh.mockResolvedValueOnce({ ...terminal, retryable: true });
    await request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(503);
    expect(JSON.parse(String((await stored())?.session)).workosSession).toBe(
      'old-seal',
    );
    fixture.refresh.mockResolvedValueOnce(terminal);
    await request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(401);
    const persisted = JSON.parse(String((await stored())?.session));
    expect(persisted).not.toHaveProperty('workosSession');
    expect(persisted.workosSessionId).toBe('session_example');
    expect(persisted.workosLogin.state).toBe('untouched-state');
    await request(second.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(401);
    expect(fixture.refresh).toHaveBeenCalledTimes(2);
  });

  it('retries payload conflicts while preserving unrelated fields and expiry', async () => {
    const collection = await first.store.collectionP;
    const before = await stored();
    const update = collection.updateOne.bind(collection);
    const concurrent = JSON.parse(String(before?.session));
    concurrent.workosLogin.state = 'concurrently-updated-state';
    vi.spyOn(collection, 'updateOne').mockImplementationOnce(
      async (...args) => {
        await update(
          { _id: sid },
          { $set: { session: JSON.stringify(concurrent) } },
        );
        return update(...args);
      },
    );
    await expect(
      replaceStoredWorkosSession(
        { sessionID: sid, sessionStore: first.store },
        'old-seal',
        'fresh-seal',
      ),
    ).resolves.toBe('fresh-seal');
    const after = await stored();
    expect(after?.expires).toEqual(before?.expires);
    expect(JSON.parse(String(after?.session))).toEqual({
      ...concurrent,
      workosSession: 'fresh-seal',
    });
    expect(collection.updateOne).toHaveBeenCalledTimes(2);
  });

  it('stops after three payload conflicts and preserves current credentials', async () => {
    const collection = await first.store.collectionP;
    const update = collection.updateOne.bind(collection);
    let conflicts = 0;
    vi.spyOn(collection, 'updateOne').mockImplementation(async (...args) => {
      if ('session' in args[0]) {
        const concurrent = JSON.parse(String((await stored())?.session));
        concurrent.workosLogin.state = `concurrent-${++conflicts}`;
        await update(
          { _id: sid },
          { $set: { session: JSON.stringify(concurrent) } },
        );
      }
      return update(...args);
    });
    await request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(503);
    expect(conflicts).toBe(3);
    const persisted = JSON.parse(String((await stored())?.session));
    expect(persisted.workosSession).toBe('old-seal');
    expect(persisted.workosLogin.state).toBe('concurrent-3');
  });

  it('preserves credentials and returns 503 on a storage write failure', async () => {
    vi.spyOn(await first.store.collectionP, 'updateOne').mockRejectedValueOnce(
      new Error('Synthetic storage outage'),
    );
    await request(first.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(503);
    expect(JSON.parse(String((await stored())?.session)).workosSession).toBe(
      'old-seal',
    );
  });
});
