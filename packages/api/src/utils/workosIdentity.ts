import type { User as WorkosUser } from '@workos-inc/node';
import { z } from 'zod';

import * as config from '@/config';
import Team from '@/models/team';
import User from '@/models/user';
import { isDuplicateKeyError } from '@/utils/errors';
import { getCounter, setBusinessContext } from '@/utils/instrumentation';

import { workos } from './workosClient';

const provisionedUsers = getCounter('hyperdx.auth.provisioned_users', {
  description: 'Members created from verified WorkOS email-domain policy',
});

export class WorkosAuthenticationError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly reason:
      | 'invalid_token'
      | 'unmapped_identity'
      | 'upstream_unavailable',
  ) {
    super('WorkOS authentication failed');
  }
}

const profileSchema = z.object({
  id: z.string().regex(/^user_[A-Za-z0-9]+$/),
  email: z.string().email(),
  emailVerified: z.literal(true),
});

/** Resolve local membership, optionally provisioning new verified-domain users. */
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
    const email = parsed.data.email.toLowerCase();
    // Bind existing members before considering the optional signup policy.
    // Both unique indexes also protect concurrent first logins and tombstones.
    try {
      user = await User.findOneAndUpdate(
        {
          email,
          team: settings.teamId,
          workosIssuer: { $exists: false },
          workosSubject: { $exists: false },
        },
        { $set: binding },
        { returnDocument: 'after' },
      );
      if (
        !user &&
        settings.autoJoinDomain &&
        settings.autoJoinDomain === email.split('@')[1]
      ) {
        user = await User.create({
          email,
          name: email,
          team: settings.teamId,
          ...binding,
        });
        setBusinessContext({
          teamId: settings.teamId,
          userId: user._id.toString(),
          email,
          'hyperdx.auth.provisioned': true,
        });
        provisionedUsers.add(1);
      }
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    // A concurrent request may have completed the identical first binding.
    user ??= await User.findOne(binding);
  }
  if (!user || user.team?.toString() !== settings.teamId) {
    throw new WorkosAuthenticationError(403, 'unmapped_identity');
  }
  return user;
}
