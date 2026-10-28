import type { User as WorkosUser } from '@workos-inc/node';
import { z } from 'zod';

import * as config from '@/config';
import Team from '@/models/team';
import User from '@/models/user';

import { workos } from './workosClient';

export class WorkosAuthenticationError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly reason:
      'invalid_token' | 'unmapped_identity' | 'upstream_unavailable',
  ) {
    super('WorkOS authentication failed');
  }
}

const profileSchema = z.object({
  id: z.string().regex(/^user_[A-Za-z0-9]+$/),
  email: z.string().email(),
  emailVerified: z.literal(true),
});

/** WorkOS authenticates identity; only existing HyperDX membership grants access. */
export async function resolveWorkosUser(subject: string) {
  const settings = config.WORKOS;
  if (!settings || !workos)
    throw new WorkosAuthenticationError(401, 'invalid_token');
  await User.init();
  if (!(await Team.exists({ _id: settings.teamId }))) {
    throw new WorkosAuthenticationError(403, 'unmapped_identity');
  }
  const binding = { workosIssuer: settings.issuer, workosSubject: subject };
  let user = await User.findOne(binding);
  if (!user) {
    let profile: WorkosUser;
    try {
      profile = await workos.userManagement.getUser(subject);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 404
      ) {
        throw new WorkosAuthenticationError(403, 'unmapped_identity');
      }
      throw new WorkosAuthenticationError(503, 'upstream_unavailable');
    }
    const parsed = profileSchema.safeParse(profile);
    if (!parsed.success || parsed.data.id !== subject) {
      throw new WorkosAuthenticationError(403, 'unmapped_identity');
    }
    // First binding is a compare-and-set on an existing, unbound member. The
    // partial unique index prevents one identity linking two local accounts.
    try {
      user = await User.findOneAndUpdate(
        {
          email: parsed.data.email.toLowerCase(),
          team: settings.teamId,
          workosIssuer: { $exists: false },
          workosSubject: { $exists: false },
        },
        { $set: binding },
        { returnDocument: 'after' },
      );
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ))
        throw error;
    }
    // A concurrent request may have completed the identical first binding.
    user ??= await User.findOne(binding);
  }
  if (!user || user.team?.toString() !== settings.teamId) {
    throw new WorkosAuthenticationError(403, 'unmapped_identity');
  }
  return user;
}
