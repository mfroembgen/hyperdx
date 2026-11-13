import request from 'supertest';

import {
  authorization,
  callbackPath,
  fixture,
  gate,
  loginReplica,
} from './workosLogin.fixture';

describe('WorkOS login across Mongo-backed replicas', () => {
  let first: ReturnType<typeof loginReplica>;
  let second: ReturnType<typeof loginReplica>;
  let cookie: string;
  let sid: string;
  const stored = async () =>
    (await first.store.collectionP).findOne({ _id: sid });
  beforeEach(async () => {
    fixture.authorize.mockReset().mockResolvedValue(authorization);
    fixture.exchange
      .mockReset()
      .mockResolvedValue({ sealedSession: 'new-login' });
    first = loginReplica();
    second = loginReplica();
    const response = await request(first.app).post('/seed').expect(200);
    cookie = response.headers['set-cookie'][0].split(';')[0];
    sid = response.body.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await (await first.store.collectionP).deleteMany({});
    await Promise.all([first.store.close(), second.store.close()]);
  });

  it('delayed initialization preserves a concurrent seal rotation', async () => {
    const entered = gate();
    const resume = gate();
    fixture.authorize.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return authorization;
    });
    const initializing = request(first.app)
      .get('/auth/workos')
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.parse(String((await stored())?.session)).workosSession).toBe(
      'fresh-seal',
    );
    resume.release();
    expect((await initializing).status).toBe(302);
    expect(JSON.parse(String((await stored())?.session)).workosSession).toBe(
      'fresh-seal',
    );
  });

  it('delayed initialization cannot resurrect completed logout', async () => {
    const entered = gate();
    const resume = gate();
    fixture.authorize.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return authorization;
    });
    const initializing = request(first.app)
      .get('/auth/workos')
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app)
      .post('/logout')
      .set('Origin', 'https://app.example.com')
      .set('Cookie', cookie)
      .expect(303);
    expect(await stored()).toBeNull();
    resume.release();
    expect((await initializing).status).toBe(400);
    expect(await stored()).toBeNull();
  });

  it('failed callback consumption preserves a concurrent seal rotation', async () => {
    const entered = gate();
    const resume = gate();
    fixture.exchange.mockRejectedValueOnce(
      new Error('Synthetic exchange failure'),
    );
    const collection = await first.store.collectionP;
    const update = collection.updateOne.bind(collection);
    vi.spyOn(collection, 'updateOne').mockImplementationOnce(
      async (...args) => {
        entered.release();
        await resume.promise;
        return update(...args);
      },
    );
    const callback = request(first.app)
      .get(callbackPath)
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(200);
    resume.release();
    expect((await callback).headers.location).toContain('workosUnavailable');
    const persisted = JSON.parse(String((await stored())?.session));
    expect(persisted).not.toHaveProperty('workosLogin');
    expect(persisted.workosSession).toBe('fresh-seal');
    expect(fixture.exchange).toHaveBeenCalledTimes(1);
  });

  it('exchanges one code for concurrent callbacks and writes the regenerated SID once', async () => {
    const entered = gate();
    const resume = gate();
    const save = vi.spyOn(first.store, 'set');
    fixture.exchange.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return { sealedSession: 'new-login' };
    });
    const callback = request(first.app)
      .get(callbackPath)
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app)
      .get(callbackPath)
      .set('Cookie', cookie)
      .expect(400);
    resume.release();
    const response = await callback;
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('https://app.example.com/search');
    expect(response.headers['set-cookie'][0].split(';')[0]).not.toBe(cookie);
    expect(fixture.exchange).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await stored()).toBeNull();
    const sessions = await (await first.store.collectionP).find({}).toArray();
    expect(sessions).toHaveLength(1);
    expect(JSON.parse(String(sessions[0].session)).workosSession).toBe(
      'new-login',
    );
  });

  it('an invalid new seal preserves a rotation completed during the exchange', async () => {
    const entered = gate();
    const resume = gate();
    fixture.exchange.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return { sealedSession: 'invalid-new-login' };
    });
    const callback = request(first.app)
      .get(callbackPath)
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app)
      .get('/protected')
      .set('Cookie', cookie)
      .expect(200);
    resume.release();
    expect((await callback).headers.location).toContain('workosDenied');
    expect(JSON.parse(String((await stored())?.session)).workosSession).toBe(
      'fresh-seal',
    );
  });

  it('completed logout cancels an in-flight successful exchange', async () => {
    const entered = gate();
    const resume = gate();
    fixture.exchange.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return { sealedSession: 'new-login' };
    });
    const callback = request(first.app)
      .get(callbackPath)
      .set('Cookie', cookie)
      .then(value => value);
    await entered.promise;
    await request(second.app)
      .post('/logout')
      .set('Origin', 'https://app.example.com')
      .set('Cookie', cookie)
      .expect(303);
    resume.release();
    const response = await callback;
    expect(response.headers.location).toContain('workosDenied');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await (await first.store.collectionP).countDocuments()).toBe(0);
  });

  it('persists an auth-free new SID once before sending its cookie', async () => {
    const entered = gate();
    const resume = gate();
    const save = first.store.set.bind(first.store);
    const set = vi
      .spyOn(first.store, 'set')
      .mockImplementationOnce((...args) => {
        entered.release();
        void resume.promise.then(() => save(...args));
      });
    let completed = false;
    const initializing = request(first.app)
      .get('/auth/workos')
      .then(value => {
        completed = true;
        return value;
      });
    await entered.promise;
    expect(completed).toBe(false);
    resume.release();
    expect((await initializing).headers['set-cookie']).toHaveLength(1);
    expect(set).toHaveBeenCalledTimes(1);
    const sessions = await (
      await first.store.collectionP
    )
      .find({ _id: { $ne: sid } })
      .toArray();
    expect(sessions).toHaveLength(1);
    expect(JSON.parse(String(sessions[0].session))).not.toHaveProperty(
      'workosSession',
    );
  });

  it('never retries or sends a cookie when an explicit new-SID save and cleanup fail', async () => {
    const set = vi
      .spyOn(first.store, 'set')
      .mockImplementationOnce((_sid, _value, callback) =>
        callback?.(new Error('Synthetic save failure')),
      );
    vi.spyOn(first.store, 'destroy').mockImplementationOnce((_sid, callback) =>
      callback?.(new Error('Synthetic cleanup failure')),
    );
    const response = await request(first.app).get('/auth/workos').expect(503);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(set).toHaveBeenCalledTimes(1);
    expect(await (await first.store.collectionP).countDocuments()).toBe(1);
  });
});
