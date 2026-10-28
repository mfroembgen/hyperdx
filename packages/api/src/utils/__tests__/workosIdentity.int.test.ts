import mongoose from 'mongoose';

import * as config from '@/config';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';
import User from '@/models/user';
import { resolveWorkosUser } from '@/utils/workosIdentity';

const fixture = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  WORKOS: {
    issuer: 'https://identity.example.com',
    teamId: '507f1f77bcf86cd799439011',
  },
}));
vi.mock('@/utils/workosClient', () => ({
  workos: { userManagement: { getUser: fixture.getUser } },
}));

describe('WorkOS existing Mongo member binding', () => {
  const teamId = '507f1f77bcf86cd799439011';
  let otherTeam: mongoose.Types.ObjectId;
  beforeAll(async () => {
    await connectDB();
    await User.init();
  });
  beforeEach(async () => {
    otherTeam = (
      await Team.create({ name: 'Other tenant', apiKey: 'other-ingestion-key' })
    )._id;
    await Team.create({
      _id: teamId,
      name: 'Configured tenant',
      apiKey: 'configured-ingestion-key',
    });
    await User.create({ email: 'member@example.com', team: teamId });
    fixture.getUser.mockReset().mockResolvedValue({
      id: 'user_member',
      email: 'MEMBER@example.com',
      emailVerified: true,
    });
  });
  afterEach(clearDBCollections);
  afterAll(closeDB);

  it('atomically links one existing member during concurrent first logins', async () => {
    const members = await Promise.all(
      Array.from({ length: 8 }, () => resolveWorkosUser('user_member')),
    );
    expect(new Set(members.map(user => user._id.toString())).size).toBe(1);
    expect(await User.countDocuments()).toBe(1);
    expect(
      await User.countDocuments({
        workosIssuer: config.WORKOS?.issuer,
        workosSubject: 'user_member',
      }),
    ).toBe(1);
  });

  it('retains the subject binding and checks fresh team membership on every use', async () => {
    const first = await resolveWorkosUser('user_member');
    fixture.getUser.mockRejectedValue(new Error('Synthetic provider outage'));
    expect((await resolveWorkosUser('user_member'))._id.toString()).toBe(
      first._id.toString(),
    );
    await User.updateOne({ _id: first._id }, { team: otherTeam });
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
    await User.updateOne({ _id: first._id }, { team: teamId });
    await Team.deleteOne({ _id: teamId });
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
    expect(fixture.getUser).toHaveBeenCalledTimes(1);
  });

  it('refuses unverified, unknown, foreign-bound and deleted accounts without provisioning', async () => {
    fixture.getUser.mockResolvedValueOnce({
      id: 'user_member',
      email: 'member@example.com',
      emailVerified: false,
    });
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
    fixture.getUser.mockResolvedValueOnce({
      id: 'user_unknown',
      email: 'unknown@example.com',
      emailVerified: true,
    });
    await expect(resolveWorkosUser('user_unknown')).rejects.toMatchObject({
      status: 403,
    });
    await User.updateOne(
      { email: 'member@example.com' },
      {
        workosIssuer: 'https://foreign.example.com',
        workosSubject: 'user_foreign',
      },
    );
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
    expect(await User.countDocuments()).toBe(1);
    await User.deleteOne({ email: 'member@example.com' });
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
    expect(await User.countDocuments()).toBe(0);
  });
});
