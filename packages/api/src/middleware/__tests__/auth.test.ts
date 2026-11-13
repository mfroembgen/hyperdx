import express, { type Request } from 'express';
import request from 'supertest';

import { LOCAL_APP_TEAM } from '@/controllers/team';
import { isUserAuthenticated } from '@/middleware/auth';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import { setBusinessContext } from '@/utils/instrumentation';

vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  IS_LOCAL_APP_MODE: true,
}));
vi.mock('@/utils/instrumentation', () => ({
  getCounter: () => ({ add: vi.fn() }),
  getActiveTraceId: () => undefined,
  getStaticFeatureFlags: () => ({}),
  setBusinessContext: vi.fn(),
}));

describe('local app authentication', () => {
  it('scopes metadata queries to the existing BSON-compatible local team', async () => {
    const app = express();
    let authenticatedRequest: Request | undefined;
    app.use(isUserAuthenticated);
    app.get('/api/sources', (req, res) => {
      authenticatedRequest = req;
      res.sendStatus(200);
    });

    await request(app).get('/api/sources').expect(200);
    if (!authenticatedRequest) throw new Error('Local authentication failed');
    const req = authenticatedRequest;

    expect(() =>
      Source.find({ team: req.user?.team }).cast(Source),
    ).not.toThrow();
    expect(() =>
      Connection.find({ team: req.user?.team }).cast(Connection),
    ).not.toThrow();
    expect(req.user?.team).toEqual(LOCAL_APP_TEAM._id);
    expect(req.user?._id).toBe('_local_user_');
    expect(LOCAL_APP_TEAM.id).toBe('_local_team_');
    expect(setBusinessContext).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: LOCAL_APP_TEAM._id.toString() }),
    );
  });
});
