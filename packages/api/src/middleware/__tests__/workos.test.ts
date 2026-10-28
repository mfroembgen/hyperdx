import express from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import mongoose from 'mongoose';
import request from 'supertest';

import { isUserAuthenticated, validateMcpUser } from '@/middleware/auth';
import Team from '@/models/team';
import User from '@/models/user';
import type { WorkosConfig } from '@/utils/workosConfig';
import { resolveWorkosUser } from '@/utils/workosIdentity';

const fixture = vi.hoisted(() => ({
  settings: {
    apiKey: 'fixture-key',
    clientId: 'client_app',
    issuer: 'https://identity.example.com',
    sessionIssuer: 'https://api.workos.com/user_management/client_app',
    teamId: '507f1f77bcf86cd799439011',
    frontendOrigin: 'https://app.example.com',
    resource: 'https://app.example.com/api/mcp',
    redirectUri: 'https://app.example.com/api/auth/workos/callback',
    metadataUrl:
      'https://app.example.com/api/.well-known/oauth-protected-resource/mcp',
  } as WorkosConfig | undefined,
  getUser: vi.fn(),
}));
vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  get WORKOS() {
    return fixture.settings;
  },
}));
vi.mock('@/utils/workosClient', () => ({
  workos: { userManagement: { getUser: fixture.getUser } },
}));

describe('WorkOS identity and MCP boundary', () => {
  const teamId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const user = new User({
    email: 'member@example.com',
    team: teamId,
    workosIssuer: 'https://identity.example.com',
    workosSubject: 'user_member',
  });
  const find = vi.spyOn(User, 'findOne');
  const bind = vi.spyOn(User, 'findOneAndUpdate');
  const team = vi.spyOn(Team, 'exists');
  vi.spyOn(User, 'init').mockResolvedValue(user);
  let privateKey: CryptoKey;
  let forged: CryptoKey;
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    Object.defineProperty(req, 'isAuthenticated', { value: () => true });
    next();
  });
  app.post('/mcp', validateMcpUser, (req, res) =>
    res.json({ user: req.user?._id.toString() }),
  );
  app.get('/ui', isUserAuthenticated, (_req, res) => res.sendStatus(200));
  const sign = (claims: Record<string, unknown> = {}, key = privateKey) =>
    new SignJWT({
      sub: 'user_member',
      sid: 'consent_example',
      client_id: 'oauth_client',
      iss: 'https://identity.example.com',
      aud: 'https://app.example.com/api/mcp',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .sign(key);

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256', { extractable: true });
    privateKey = keys.privateKey;
    forged = (await generateKeyPair('RS256')).privateKey;
    const jwk = await exportJWK(keys.publicKey);
    vi.mocked(global.fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ keys: [{ ...jwk, kid: 'fixture', alg: 'RS256' }] }),
        ),
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    find.mockReset().mockResolvedValue(user);
    bind.mockReset().mockResolvedValue(null);
    team.mockReset().mockResolvedValue({ _id: teamId });
    fixture.getUser.mockReset().mockResolvedValue({
      id: 'user_member',
      email: 'MEMBER@example.com',
      emailVerified: true,
    });
  });

  it('verifies Connect JWTs and resolves fresh existing membership without trusting email claims', async () => {
    await request(app)
      .post('/mcp')
      .set(
        'Authorization',
        `Bearer ${await sign({ email: 'attacker@example.com' })}`,
      )
      .expect(200);
    expect(fixture.getUser).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledWith({
      workosIssuer: 'https://identity.example.com',
      workosSubject: 'user_member',
    });
    expect(bind).not.toHaveBeenCalled();
  });

  it.each([
    ['other issuer', { iss: 'https://other.example.com' }],
    [
      'other environment/resource',
      { aud: 'https://other.example.com/api/mcp' },
    ],
    ['web token', { iss: 'https://api.workos.com/user_management/client_app' }],
    ['M2M token', { sub: 'client_machine', sid: undefined }],
    ['missing expiry', { exp: undefined }],
    ['expired token', { exp: 1 }],
    ['missing consent', { sid: undefined }],
    ['widget token', { sub_type: 'widget' }],
  ])('rejects %s before member lookup', async (_label, claims) => {
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${await sign(claims)}`)
      .expect(401);
    expect(fixture.getUser).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it('rejects forged tokens, opaque API keys and legacy browser sessions in WorkOS mode', async () => {
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${await sign({}, forged)}`)
      .expect(401);
    const denied = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer personal-key')
      .expect(401);
    expect(denied.headers['www-authenticate']).toContain(
      'resource_metadata="https://app.example.com/api/.well-known/oauth-protected-resource/mcp"',
    );
    await request(app).get('/ui').expect(401);
    expect(find).not.toHaveBeenCalled();
  });

  it('denies unverified, deleted and removed members on their next request', async () => {
    const token = await sign();
    find.mockResolvedValueOnce(null);
    fixture.getUser.mockResolvedValueOnce({
      id: 'user_member',
      email: user.email,
      emailVerified: false,
    });
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    find.mockResolvedValueOnce(
      new User({ email: user.email, team: new mongoose.Types.ObjectId() }),
    );
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    team.mockResolvedValueOnce(null);
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    find.mockResolvedValueOnce(null);
    fixture.getUser.mockRejectedValueOnce({ status: 404 });
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('binds only an existing unbound member and refuses a conflicting association', async () => {
    find.mockResolvedValue(null);
    bind.mockResolvedValueOnce(user);
    await expect(resolveWorkosUser('user_member')).resolves.toBe(user);
    expect(bind).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'member@example.com',
        team: teamId.toString(),
        workosSubject: { $exists: false },
        workosIssuer: { $exists: false },
      }),
      expect.anything(),
      { returnDocument: 'after' },
    );
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('preserves personal API keys when WorkOS is unset', async () => {
    const previous = fixture.settings;
    fixture.settings = undefined;
    try {
      await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${user.accessKey}`)
        .expect(200);
      expect(find).toHaveBeenCalledWith({ accessKey: user.accessKey });
    } finally {
      fixture.settings = previous;
    }
  });
});
