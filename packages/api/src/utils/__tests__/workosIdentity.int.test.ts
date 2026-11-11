import mongoose from 'mongoose';

import * as config from '@/config';
import { deleteTeamMember, findUsersByTeam } from '@/controllers/user';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';
import User from '@/models/user';
import { resolveWorkosUser } from '@/utils/workosIdentity';

const fixture = vi.hoisted(() => ({
  getUser: vi.fn(),
  enabled: true,
  settings: {
    issuer: 'https://identity.example.com',
    teamId: '507f1f77bcf86cd799439011',
    autoJoinDomain: undefined as string | undefined,
  },
}));
vi.mock('@/config', async () => ({
  ...(await vi.importActual<typeof import('@/config')>('@/config')),
  get WORKOS() {
    return fixture.enabled ? fixture.settings : undefined;
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
    fixture.enabled = true;
    fixture.settings.autoJoinDomain = undefined;
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

  it('creates one passwordless member for concurrent first logins from the exact verified domain', async () => {
    fixture.settings.autoJoinDomain = 'example.com';
    fixture.getUser.mockResolvedValue({
      id: 'user_new',
      email: 'NEW@EXAMPLE.COM',
      emailVerified: true,
    });
    const members = await Promise.all(
      Array.from({ length: 8 }, () => resolveWorkosUser('user_new')),
    );
    expect(new Set(members.map(user => user._id.toString())).size).toBe(1);
    const created = await User.findOne({ email: 'new@example.com' }).lean();
    expect(created).toMatchObject({
      name: 'new@example.com',
      team: new mongoose.Types.ObjectId(teamId),
      workosIssuer: config.WORKOS?.issuer,
      workosSubject: 'user_new',
    });
    expect(created).not.toHaveProperty('hash');
    expect(created).not.toHaveProperty('salt');
    expect(await User.countDocuments()).toBe(2);
    fixture.getUser.mockClear();
    await expect(resolveWorkosUser('user_new')).resolves.toMatchObject({
      email: 'new@example.com',
    });
    expect(fixture.getUser).not.toHaveBeenCalled();
  });

  it('reports real password credentials without returning them in member metadata', async () => {
    const email = 'pwd@example.com';
    await User.schema.statics.register.call(
      User,
      { email, name: email, team: teamId },
      'Fixture-password!234',
    );
    const passwordUser = await User.findOne({ email }).orFail();
    expect(passwordUser.get('hash')).toBeUndefined();
    expect(passwordUser.get('salt')).toBeUndefined();
    fixture.settings.autoJoinDomain = 'example.com';
    fixture.getUser.mockResolvedValue({
      id: 'user_new',
      email: 'new@example.com',
      emailVerified: true,
    });
    await resolveWorkosUser('user_new');
    await User.create({ email: 'foreign@example.com', team: otherTeam });
    const members = await findUsersByTeam(teamId);
    expect(await findUsersByTeam(new mongoose.Types.ObjectId(teamId))).toEqual(
      members,
    );
    expect(members.map(({ _id, ...member }) => member)).toEqual([
      { email: 'member@example.com', hasPasswordAuth: false },
      { email, name: email, hasPasswordAuth: true },
      {
        email: 'new@example.com',
        name: 'new@example.com',
        hasPasswordAuth: false,
      },
    ]);
  });

  it.each([
    ['new@other-example.com', true],
    ['new@example.com.attacker.com', true],
    ['new@sub.example.com', true],
    ['new@example.com', false],
  ])(
    'refuses automatic membership for %s with verified=%s',
    async (email, emailVerified) => {
      fixture.settings.autoJoinDomain = 'example.com';
      fixture.getUser.mockResolvedValue({
        id: 'user_new',
        email,
        emailVerified,
      });
      await expect(resolveWorkosUser('user_new')).rejects.toMatchObject({
        status: 403,
      });
      expect(await User.countDocuments()).toBe(1);
    },
  );

  it('keeps existing members outside the automatic join domain eligible for binding', async () => {
    fixture.settings.autoJoinDomain = 'example.com';
    await User.updateOne(
      { email: 'member@example.com' },
      { email: 'member@other.example.com' },
    );
    fixture.getUser.mockResolvedValue({
      id: 'user_member',
      email: 'member@other.example.com',
      emailVerified: true,
    });
    await expect(resolveWorkosUser('user_member')).resolves.toMatchObject({
      email: 'member@other.example.com',
    });
    expect(await User.countDocuments()).toBe(1);
  });

  it.each(['foreign team', 'conflicting identity'])(
    'never replaces a %s with automatic membership',
    async conflict => {
      fixture.settings.autoJoinDomain = 'example.com';
      const changes =
        conflict === 'foreign team'
          ? { team: otherTeam }
          : {
              workosIssuer: config.WORKOS?.issuer,
              workosSubject: 'user_other',
            };
      await User.updateOne({ email: 'member@example.com' }, changes);
      await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
        status: 403,
      });
      expect(await User.countDocuments()).toBe(1);
      expect(await User.findOne({ email: 'member@example.com' })).toMatchObject(
        changes,
      );
    },
  );

  it('retains removed bound and unbound members so automatic signup cannot restore them', async () => {
    fixture.settings.autoJoinDomain = 'example.com';
    const member = await resolveWorkosUser('user_member');
    const unbound = await User.create({
      email: 'unbound@example.com',
      team: teamId,
    });
    for (const removed of [member, unbound]) {
      expect(
        await deleteTeamMember(
          teamId,
          removed.id,
          new mongoose.Types.ObjectId(),
        ),
      ).toBeTruthy();
      expect(await User.findById(removed._id)).not.toHaveProperty(
        'team',
        expect.anything(),
      );
      expect(await User.findOne({ accessKey: removed.accessKey })).toBeNull();
    }
    await expect(resolveWorkosUser('user_member')).rejects.toMatchObject({
      status: 403,
    });
    fixture.getUser.mockResolvedValue({
      id: 'user_recreated',
      email: member.email,
      emailVerified: true,
    });
    await expect(resolveWorkosUser('user_recreated')).rejects.toMatchObject({
      status: 403,
    });
    fixture.getUser.mockResolvedValue({
      id: 'user_unbound',
      email: unbound.email,
      emailVerified: true,
    });
    await expect(resolveWorkosUser('user_unbound')).rejects.toMatchObject({
      status: 403,
    });
    expect(await User.countDocuments()).toBe(2);
    expect(await User.countDocuments({ team: teamId })).toBe(0);
    expect(await findUsersByTeam(teamId)).toEqual([]);
  });

  it('preserves physical member deletion when WorkOS is unset', async () => {
    fixture.enabled = false;
    const member = await User.findOne({ email: 'member@example.com' }).orFail();
    expect(
      await deleteTeamMember(teamId, member.id, new mongoose.Types.ObjectId()),
    ).toBeTruthy();
    expect(await User.findById(member._id)).toBeNull();
    expect(await User.countDocuments()).toBe(0);
  });
});
