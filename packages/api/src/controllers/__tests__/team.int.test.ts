import * as config from '@/config';
import {
  createTeam,
  getTeam,
  getTeamByApiKey,
  getTeamInviteUrl,
} from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';

describe('getTeamInviteUrl', () => {
  it('builds the join-team URL for a token', () => {
    expect(getTeamInviteUrl('abc123')).toBe(
      `${config.FRONTEND_URL}/join-team?token=abc123`,
    );
  });
});

describe('team controller', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  it('createTeam + getTeam', async () => {
    const team = await createTeam({ name: 'My Team' });

    expect(team.name).toBe('My Team');

    team.apiKey = 'apiKey';

    await team.save();

    expect(await getTeam(team._id)).toBeTruthy();
    expect(await getTeamByApiKey('apiKey')).toBeTruthy();
  });

  it('returns only the requested team when multiple teams exist', async () => {
    const first = await Team.create({ name: 'First team' });
    const second = await Team.create({ name: 'Second team' });
    expect((await getTeam(second._id))?._id).toEqual(second._id);
    expect((await getTeam(first._id))?._id).toEqual(first._id);
    await second.deleteOne();
    expect(await getTeam(second._id)).toBeNull();
  });
});
